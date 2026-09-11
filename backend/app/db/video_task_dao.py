import json
import time
from typing import Optional

from app.db.engine import get_db
from app.db.models.video_tasks import VideoTask
from app.utils.logger import get_logger

logger = get_logger(__name__)

# ── 任务状态文件的进程内 TTL 缓存 ──────────────────────────────
# 前端每 10s 轮询一次 /history + /batch_status/{id}，light 模式下每条任务都要
# stat + open + json.load 一次 {task_id}.status.json（46B，但每轮 ~585 次系统调用）。
# 状态文件很小且只在任务生命周期内变化（6-8 次写入），缓存数秒即可把轮询的
# 磁盘 IO 从 O(任务数) 降到 O(变更数)。
_STATUS_CACHE_TTL = 2.0  # 秒
_status_cache: dict[str, tuple[float, tuple[Optional[str], str]]] = {}


def _cached_load_task_status(task_id: str, *, row=None):
    """带 TTL 的状态文件读取；status 文件几乎不变，2s 内命中缓存避免重复 stat/open。"""
    now = time.monotonic()
    cached = _status_cache.get(task_id)
    if cached and now - cached[0] < _STATUS_CACHE_TTL:
        return cached[1]
    status, message = _read_task_status_file(task_id, row=row)
    _status_cache[task_id] = (now, (status, message))
    return status, message


def invalidate_task_status_cache(task_id: str) -> None:
    """状态写入后调用，强制下次读取重新读盘。"""
    _status_cache.pop(task_id, None)


def _read_task_status_file(task_id: str, *, row=None):
    """真实读盘逻辑；从 note.py 的 _load_task_status 中抽取，避免循环依赖。"""
    from app.utils.output_paths import task_status_path
    status_path = task_status_path(task_id)
    if not status_path.exists():
        return None, ''
    try:
        with status_path.open('r', encoding='utf-8') as f:
            status_content = json.load(f)
        status = status_content.get('status')
        message = _resolve_failed_status_message(status, status_content.get('message', ''), row=row)
        return status, message
    except Exception:
        return None, ''


def _resolve_failed_status_message(status: Optional[str], message: Optional[str], *, row=None) -> str:
    """等价于 note.py 的 _resolve_failed_message；抽到共享层避免 dao↔router 循环导入。"""
    from app.enmus.task_status_enums import TaskStatus
    text = str(message or '').strip()
    if status != TaskStatus.FAILED.value:
        return text
    if text:
        return text
    platform = getattr(row, 'platform', None) if row else None
    source_url = getattr(row, 'source_url', None) if row else None
    video_id = getattr(row, 'video_id', None) if row else None
    return _fallback_failed_message(platform=platform, source_url=source_url, video_id=video_id)


def _fallback_failed_message(*, platform: Optional[str], source_url: Optional[str], video_id: Optional[str]) -> str:
    if platform == 'douyin':
        from app.utils.url_parser import extract_video_id
        target = video_id or extract_video_id(source_url or '', 'douyin') or '该视频'
        return (
            f'抖音视频 {target} 可能已删除、不可访问，或详情接口未返回有效视频信息。'
            '请检查链接是否仍可打开，或稍后重试。'
        )
    return '任务失败，未写入详细原因'


def _serialize_request_payload(request_payload: Optional[dict]) -> Optional[str]:
    if request_payload is None:
        return None
    return json.dumps(request_payload, ensure_ascii=False)


def _deserialize_request_payload(request_payload: Optional[str]) -> Optional[dict]:
    if not request_payload:
        return None
    try:
        return json.loads(request_payload)
    except Exception as e:
        logger.warning(f'Failed to parse request_payload: {e}')
        return None


def _attach_request_payload(task: Optional[VideoTask]) -> Optional[VideoTask]:
    if not task:
        return task
    task.request_payload_data = _deserialize_request_payload(getattr(task, 'request_payload', None))
    return task


def _attach_request_payload_list(tasks: list[VideoTask]) -> list[VideoTask]:
    return [_attach_request_payload(task) for task in tasks]


def insert_video_task(
    video_id: str,
    platform: str,
    task_id: str,
    batch_id: Optional[str] = None,
    batch_name: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    request_payload: Optional[dict] = None,
) -> bool:
    db = next(get_db())
    try:
        task = VideoTask(
            video_id=video_id,
            platform=platform,
            task_id=task_id,
            batch_id=batch_id,
            batch_name=batch_name,
            source_url=source_url,
            title=title,
            request_payload=_serialize_request_payload(request_payload),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        logger.info(
            'Video task inserted successfully. video_id: %s, platform: %s, task_id: %s, batch_id: %s',
            video_id,
            platform,
            task_id,
            batch_id,
        )
        return True
    except Exception as e:
        # Retries reuse the original task_id. Treat a unique-key collision as
        # an idempotent replay instead of dropping the retry metadata.
        db.rollback()
        try:
            existing = db.query(VideoTask).filter_by(task_id=task_id).first()
            if existing:
                if batch_id is not None:
                    existing.batch_id = batch_id
                if batch_name is not None:
                    existing.batch_name = batch_name
                if source_url is not None:
                    existing.source_url = source_url
                if title is not None:
                    existing.title = title
                if request_payload is not None:
                    existing.request_payload = _serialize_request_payload(request_payload)
                db.commit()
                logger.info('Reused existing video task on retry. task_id: %s', task_id)
                return True
        except Exception as retry_error:
            db.rollback()
            logger.error(f'Failed to reuse existing video task: {retry_error}')
        logger.error(f'Failed to insert video task: {e}')
        return False
    finally:
        db.close()


def get_task_by_video(video_id: str, platform: str):
    db = next(get_db())
    try:
        task = (
            db.query(VideoTask)
            .filter_by(video_id=video_id, platform=platform)
            .order_by(VideoTask.created_at.desc())
            .first()
        )
        if task:
            logger.info(f'Task found for video_id: {video_id} and platform: {platform}')
            return task.task_id
        logger.info(f'No task found for video_id: {video_id} and platform: {platform}')
        return None
    except Exception as e:
        logger.error(f'Failed to get task by video: {e}')
    finally:
        db.close()


def get_latest_task_record(video_id: str, platform: str):
    db = next(get_db())
    try:
        task = (
            db.query(VideoTask)
            .filter_by(video_id=video_id, platform=platform)
            .order_by(VideoTask.created_at.desc())
            .first()
        )
        return _attach_request_payload(task)
    except Exception as e:
        logger.error(f'Failed to get latest task record: {e}')
        return None
    finally:
        db.close()


def get_task_record(task_id: str):
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        return _attach_request_payload(task)
    except Exception as e:
        logger.error(f'Failed to get task record: {e}')
        return None
    finally:
        db.close()


def list_recent_tasks(limit: int = 100, offset: int = 0, batch_id: str | None = None):
    db = next(get_db())
    try:
        query = db.query(VideoTask).order_by(VideoTask.created_at.desc())
        if batch_id == '__none__':
            # 特例：只取未归入任何项目的任务
            query = query.filter(
                (VideoTask.batch_id.is_(None)) | (VideoTask.batch_id == '')
            )
        elif batch_id:
            query = query.filter(VideoTask.batch_id == batch_id)
        tasks = query.offset(max(offset, 0)).limit(limit).all()
        return _attach_request_payload_list(tasks)
    except Exception as e:
        logger.error(f'Failed to list recent tasks: {e}')
        return []
    finally:
        db.close()


def list_all_tasks():
    db = next(get_db())
    try:
        tasks = db.query(VideoTask).order_by(VideoTask.created_at.desc()).all()
        return _attach_request_payload_list(tasks)
    except Exception as e:
        logger.error(f'Failed to list all tasks: {e}')
        return []
    finally:
        db.close()


def list_all_task_ids() -> list[str]:
    """轻量查询：只取 task_id 列，避免对全表反序列化 request_payload。

    用于启动期卡住任务恢复等"只需要 id 集合"的场景（原实现拉全量 ORM + json.loads）。
    """
    db = next(get_db())
    try:
        rows = db.query(VideoTask.task_id).all()
        return [row[0] for row in rows if row[0]]
    except Exception as e:
        logger.error(f'Failed to list all task ids: {e}')
        return []
    finally:
        db.close()


def list_tasks_by_batch(batch_id: str):
    db = next(get_db())
    try:
        tasks = (
            db.query(VideoTask)
            .filter_by(batch_id=batch_id)
            .order_by(VideoTask.created_at.asc())
            .all()
        )
        return _attach_request_payload_list(tasks)
    except Exception as e:
        logger.error(f'Failed to list tasks by batch: {e}')
        return []
    finally:
        db.close()


def update_task_title(task_id: str, title: Optional[str]):
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        if not task:
            return False
        task.title = title
        db.commit()
        return True
    except Exception as e:
        logger.error(f'Failed to update task title: {e}')
        return False
    finally:
        db.close()


def update_task_request_payload(task_id: str, request_payload: Optional[dict]):
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        if not task:
            return False
        task.request_payload = _serialize_request_payload(request_payload)
        db.commit()
        return True
    except Exception as e:
        logger.error(f'Failed to update task request payload: {e}')
        return False
    finally:
        db.close()


def delete_task_by_video(video_id: str, platform: str):
    db = next(get_db())
    try:
        tasks = db.query(VideoTask).filter_by(video_id=video_id, platform=platform).all()
        for task in tasks:
            db.delete(task)
        db.commit()
        logger.info(f'Task(s) deleted for video_id: {video_id} and platform: {platform}')
    except Exception as e:
        logger.error(f'Failed to delete task by video: {e}')
    finally:
        db.close()


def delete_task_by_id(task_id: str):
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        if not task:
            return False
        db.delete(task)
        db.commit()
        logger.info(f'Task deleted for task_id: {task_id}')
        return True
    except Exception as e:
        logger.error(f'Failed to delete task by id: {e}')
        return False
    finally:
        db.close()


def clear_batch_by_id(batch_id: str) -> int:
    db = next(get_db())
    try:
        tasks = db.query(VideoTask).filter_by(batch_id=batch_id).all()
        for task in tasks:
            task.batch_id = None
            task.batch_name = None
        db.commit()
        logger.info(f'Cleared batch association for batch_id: {batch_id}, count: {len(tasks)}')
        return len(tasks)
    except Exception as e:
        logger.error(f'Failed to clear batch by id: {e}')
        return 0
    finally:
        db.close()


def rename_batch(batch_id: str, new_name: str) -> bool:
    """Rename all tasks in a batch to a new batch_name."""
    db = next(get_db())
    try:
        tasks = db.query(VideoTask).filter_by(batch_id=batch_id).all()
        if not tasks:
            return False
        for task in tasks:
            task.batch_name = new_name
        db.commit()
        return True
    except Exception as e:
        logger.error(f'Failed to rename batch: {e}')
        return False
    finally:
        db.close()


def move_task_to_batch(task_id: str, batch_id: str, batch_name: str) -> bool:
    """Move a single task into a batch."""
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        if not task:
            return False
        task.batch_id = batch_id
        task.batch_name = batch_name
        db.commit()
        return True
    except Exception as e:
        logger.error(f'Failed to move task to batch: {e}')
        return False
    finally:
        db.close()


def get_all_batches() -> list:
    """Get distinct batch_id + batch_name pairs."""
    db = next(get_db())
    try:
        from sqlalchemy import distinct
        rows = (
            db.query(distinct(VideoTask.batch_id), VideoTask.batch_name)
            .filter(VideoTask.batch_id.isnot(None))
            .order_by(VideoTask.batch_id.desc())
            .all()
        )
        return [{'batch_id': r[0], 'batch_name': r[1]} for r in rows]
    except Exception as e:
        logger.error(f'Failed to get all batches: {e}')
        return []
    finally:
        db.close()
