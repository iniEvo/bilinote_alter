# app/routers/note.py
import json
import os
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from app.db.video_task_dao import (
    clear_batch_by_id,
    rename_batch,
    move_task_to_batch,
    get_all_batches,
    delete_task_by_id,
    get_latest_task_record,
    get_task_record,
    insert_video_task,
    list_all_tasks,
    list_recent_tasks,
    list_tasks_by_batch,
    update_task_request_payload,
    update_task_title,
)
from app.enmus.exception import NoteErrorEnum, ProviderErrorEnum
from app.enmus.note_enums import DownloadQuality
from app.enmus.task_status_enums import TaskStatus
from app.exceptions.note import NoteError
from app.services.note import NoteGenerator, logger
from app.services.batch_control_store import BatchControlStore
from app.services.task_serial_executor import task_serial_executor
from app.utils.output_paths import (
    audio_json_path,
    markdown_status_path,
    note_json_path,
    note_markdown_path,
    task_status_path,
    transcript_json_path,
)
from app.utils.response import ResponseWrapper as R
from app.utils.url_parser import extract_video_id
from app.utils.path_helper import resolve_app_path
from app.validators.video_url_validator import is_supported_video_url


DOUYIN_CANONICAL_BASE = 'https://www.douyin.com/video/'


router = APIRouter()
_video_task_lock = Lock()
_inflight_video_tasks: dict[tuple[str, str], str] = {}
_batch_controls = BatchControlStore()
_STALE_PENDING_GRACE = timedelta(seconds=30)


def _make_batch_name() -> str:
    return datetime.now().strftime('%Y%m%d%H%M%S')


def _normalize_duplicate_key(video_url: Optional[str], platform: Optional[str]) -> Optional[str]:
    candidate = str(video_url or '').strip()
    if not candidate:
        return None
    if not platform:
        return candidate
    video_id = extract_video_id(candidate, platform)
    if video_id:
        return f'{platform}:{video_id}'
    return candidate


def _detect_url_platform(url: Optional[str]) -> Optional[str]:
    """从链接内容推断真实平台，用于前端平台参数缺失/错选时兜底。"""
    text = str(url or '').strip().lower()
    if not text:
        return None
    if 'douyin.com' in text or 'v.douyin' in text or 'iesdouyin' in text:
        return 'douyin'
    if 'bilibili.com' in text or 'b23.tv' in text or 'bilibili' in text:
        return 'bilibili'
    if 'youtube.com' in text or 'youtu.be' in text:
        return 'youtube'
    if 'kuaishou.com' in text or 'kuaishou' in text or 'chenzhongtech' in text:
        return 'kuaishou'
    return None


def _find_duplicate_task_with_fallback(video_url: str, platform: str):
    """按指定平台查历史重复；若该平台解析不出视频 ID，
    则按链接真实平台兜底再查一次，避免平台错选导致漏判。"""
    video_id = extract_video_id(video_url, platform)
    duplicate = _find_duplicate_task(video_id, video_url, platform)
    if duplicate:
        return duplicate
    real_platform = _detect_url_platform(video_url)
    if real_platform and real_platform != platform:
        real_id = extract_video_id(video_url, real_platform)
        if real_id:
            return _find_duplicate_task(real_id, video_url, real_platform)
    return None


def _is_task_recently_enqueued(row) -> bool:
    created_at = getattr(row, 'created_at', None)
    if created_at is None:
        return False
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at)
        except ValueError:
            return False
    return datetime.now() - created_at <= _STALE_PENDING_GRACE


def _format_created_at(dt) -> str | None:
    """规范化时间输出：naive(UTC) → 标准 ISO 8601（T 分隔 + 时区偏移）。

    SQLite 的 CURRENT_TIMESTAMP 存 UTC 且无微秒，datetime.isoformat() 输出
    "2026-09-08 09:47:00"（空格分隔），直接 +'Z' 得到 "2026-09-08 09:47:00Z"，
    部分 JS 引擎（Safari/JSC）解析失败或按本地时区误读。统一转成
    "2026-09-08T09:47:00+00:00" 后前端 new Date() 会正确转到本地时区。
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _fallback_task_status(task_id: str, *, row=None):
    if row is not None and (_is_task_recently_enqueued(row) or task_id in _inflight_video_tasks.values()):
        return TaskStatus.PENDING.value, '任务排队中'
    if row is not None:
        return TaskStatus.FAILED.value, '任务未成功启动，请重试'
    return TaskStatus.PENDING.value, ''


class DeleteTaskRequest(BaseModel):
    task_id: str


class BatchActionRequest(BaseModel):
    batch_id: str


class BatchRetryFailedRequest(BaseModel):
    batch_id: str
    task_id: Optional[str] = None
    provider_id: Optional[str] = None
    model_name: Optional[str] = None


class BatchResumeRequest(BaseModel):
    batch_id: str
    include_pending: Optional[bool] = False
    limit: Optional[int] = None
    provider_id: Optional[str] = None
    model_name: Optional[str] = None


class FixNoteTitlesRequest(BaseModel):
    fetch_online: Optional[bool] = False


class VideoRequest(BaseModel):
    video_url: str = ''
    platform: str
    quality: DownloadQuality
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    model_name: str
    provider_id: str
    task_id: Optional[str] = None
    format: Optional[list] = []
    style: str = None
    extras: Optional[str] = None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    prefetched_transcript: Optional[dict] = None
    force_regenerate: Optional[bool] = False
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None

    @field_validator('video_url')
    def validate_supported_url(cls, v):
        url = str(v).strip()
        if not url:
            return ''
        parsed = urlparse(url)
        if parsed.scheme in ('http', 'https') and not is_supported_video_url(url):
            raise NoteError(
                code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message,
            )
        return url


class BatchVideoRequest(BaseModel):
    video_urls: list[str]
    platform: str
    quality: DownloadQuality
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    model_name: str
    provider_id: str
    format: Optional[list] = []
    style: str = None
    extras: Optional[str] = None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    force_regenerate: Optional[bool] = False
    duplicate_strategy: str = 'confirm'
    duplicate_confirm_urls: Optional[list[str]] = []
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None

    @field_validator('video_urls')
    def validate_video_urls(cls, v: list[str]):
        cleaned = []
        seen = set()
        for raw in v:
            url = str(raw).strip()
            if not url or url in seen:
                continue
            parsed = urlparse(url)
            if parsed.scheme in ('http', 'https') and not is_supported_video_url(url):
                raise NoteError(
                    code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                    message=f'不支持的视频链接: {url}',
                )
            cleaned.append(url)
            seen.add(url)
        if not cleaned:
            raise ValueError('请至少输入一个有效视频链接')
        return cleaned


# 锚定到后端目录（main.py 所在目录），与启动 CWD 无关
UPLOAD_DIR = resolve_app_path('uploads')


def save_note_to_file(task_id: str, note):
    with note_json_path(task_id).open('w', encoding='utf-8') as f:
        json.dump(asdict(note), f, ensure_ascii=False, indent=2)

    legacy_markdown_path = note_markdown_path(task_id)
    titled_markdown_path = note_markdown_path(task_id, getattr(note.audio_meta, 'title', None))
    titled_markdown_path.write_text(note.markdown, encoding='utf-8')
    if legacy_markdown_path != titled_markdown_path and legacy_markdown_path.exists():
        legacy_markdown_path.unlink()


def _load_note_result(task_id: str):
    result_path = note_json_path(task_id)
    if not result_path.exists():
        return None
    with result_path.open('r', encoding='utf-8') as f:
        return json.load(f)


def _fallback_failed_message(*, platform: Optional[str], source_url: Optional[str], video_id: Optional[str]) -> str:
    if platform == 'douyin':
        target = video_id or extract_video_id(source_url or '', 'douyin') or '该视频'
        return (
            f'抖音视频 {target} 可能已删除、不可访问，或详情接口未返回有效视频信息。'
            '请检查链接是否仍可打开，或稍后重试。'
        )
    return '任务失败，未写入详细原因'


def _resolve_failed_message(status: Optional[str], message: Optional[str], *, row=None) -> str:
    text = str(message or '').strip()
    if status != TaskStatus.FAILED.value:
        return text
    if text:
        return text
    platform = getattr(row, 'platform', None) if row else None
    source_url = getattr(row, 'source_url', None) if row else None
    video_id = getattr(row, 'video_id', None) if row else None
    return _fallback_failed_message(platform=platform, source_url=source_url, video_id=video_id)


def _load_task_status(task_id: str, *, row=None):
    status_path = task_status_path(task_id)
    if not status_path.exists():
        return None, ''
    try:
        with status_path.open('r', encoding='utf-8') as f:
            status_content = json.load(f)
        status = status_content.get('status')
        message = _resolve_failed_message(status, status_content.get('message', ''), row=row)
        return status, message
    except Exception:
        return None, ''


def _persist_prefetched_transcript(task_id: str, transcript: dict) -> None:
    segments = transcript.get('segments') or []
    cleaned_segments = []
    for s in segments:
        text = (s.get('text') or '').strip()
        if not text:
            continue
        cleaned_segments.append({
            'start': float(s.get('start', 0)),
            'end': float(s.get('end', 0)),
            'text': text,
        })
    if not cleaned_segments:
        raise ValueError('prefetched_transcript 没有可用的 segments')

    full_text = transcript.get('full_text') or ' '.join(s['text'] for s in cleaned_segments)
    payload = {
        'language': transcript.get('language') or 'zh',
        'full_text': full_text,
        'segments': cleaned_segments,
    }

    target = transcript_json_path(task_id)
    with target.open('w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f'已写入客户端预取字幕缓存: {target} ({len(cleaned_segments)} 段)')


def _resolve_effective_status(task_id: str, result=None, *, row=None):
    result = result if result is not None else _load_note_result(task_id)
    status, message = _load_task_status(task_id, row=row)
    if result is not None:
        return TaskStatus.SUCCESS.value, ''
    if status:
        return status, message
    # A fresh queue entry may not have written its status file yet; keep it
    # visible briefly, but do not let orphaned DB rows stay pending forever.
    fallback_status, fallback_message = _fallback_task_status(task_id, row=row)
    return fallback_status, message or fallback_message


def _history_sort_priority(item: dict) -> tuple[int, float]:
    status = item.get('status')
    if status in {
        TaskStatus.PENDING.value,
        TaskStatus.PARSING.value,
        TaskStatus.DOWNLOADING.value,
        TaskStatus.TRANSCRIBING.value,
        TaskStatus.SUMMARIZING.value,
        TaskStatus.FORMATTING.value,
        TaskStatus.SAVING.value,
    }:
        return 0, 0.0
    if status == TaskStatus.PAUSED.value:
        return 1, 0.0
    if status in {TaskStatus.FAILED.value, TaskStatus.RETRYABLE.value}:
        return 2, 0.0
    if status == TaskStatus.CANCELED.value:
        return 3, 0.0
    return 4, 0.0



def _build_task_item(task_id: str, *, row=None):
    result = _load_note_result(task_id)
    status, message = _resolve_effective_status(task_id, result=result, row=row)
    request_payload = dict(getattr(row, 'request_payload_data', None) or {})
    source_url = _canonical_video_url(
        getattr(row, 'platform', None),
        getattr(row, 'video_id', None),
        getattr(row, 'source_url', None) or request_payload.get('video_url'),
    )
    if source_url and request_payload.get('video_url') != source_url:
        request_payload['video_url'] = source_url
    return {
        'task_id': task_id,
        'video_id': getattr(row, 'video_id', None),
        'platform': getattr(row, 'platform', None),
        'batch_id': getattr(row, 'batch_id', None),
        'batch_name': getattr(row, 'batch_name', None),
        'source_url': source_url,
        'title': getattr(row, 'title', None),
        'created_at': _format_created_at(getattr(row, 'created_at', None)),
        'status': status,
        'message': message,
        'result': result,
        'request_payload': request_payload,
    }


def _delete_task_data(task_id: str) -> bool:
    """Delete a task record and all generated files belonging to it."""
    result_content = _load_note_result(task_id) or {}
    title = ((result_content.get('audio_meta') or {}).get('title') if isinstance(result_content, dict) else None)
    markdown_paths = {
        note_markdown_path(task_id),
        note_markdown_path(task_id, title),
    }
    paths = (
        task_status_path(task_id),
        note_json_path(task_id),
        audio_json_path(task_id),
        transcript_json_path(task_id),
        *markdown_paths,
        markdown_status_path(task_id),
    )
    had_files = any(path.exists() for path in paths)
    deleted = delete_task_by_id(task_id)
    for path in paths:
        if path.exists():
            path.unlink()
    return deleted or had_files


def _check_transcriber_readiness(skip_check: bool = False):
    if skip_check:
        return None
    from app.services.transcriber_config_manager import TranscriberConfigManager

    readiness = TranscriberConfigManager().is_model_ready()
    if not readiness['ready']:
        logger.warning(f"拒绝 generate_note：{readiness['reason']}")
        return R.error(
            msg=readiness['reason'],
            code=300102,
            data={
                'reason': 'transcriber_model_not_ready',
                'transcriber_type': readiness['transcriber_type'],
                'model_size': readiness['model_size'],
                'downloading': readiness['downloading'],
            },
        )
    return None


def _canonical_video_url(platform: Optional[str], video_id: Optional[str], fallback_url: Optional[str] = None) -> Optional[str]:
    if platform == 'douyin' and video_id:
        return f'{DOUYIN_CANONICAL_BASE}{video_id}'
    return fallback_url


def _find_duplicate_task(video_id: Optional[str], video_url: str, platform: str):
    target_id = video_id or video_url
    if not target_id:
        return None
    row = get_latest_task_record(target_id, platform)
    if not row:
        return None
    result = _load_note_result(row.task_id)
    status, message = _resolve_effective_status(row.task_id, result=result, row=row)
    request_payload = dict(getattr(row, 'request_payload_data', None) or {})
    source_url = _canonical_video_url(row.platform, row.video_id, row.source_url)
    if source_url and request_payload.get('video_url') != source_url:
        request_payload['video_url'] = source_url
    return {
        'task_id': row.task_id,
        'video_id': row.video_id,
        'platform': row.platform,
        'batch_id': row.batch_id,
        'batch_name': getattr(row, 'batch_name', None),
        'source_url': source_url,
        'title': row.title,
        'created_at': _format_created_at(row.created_at),
        'status': status,
        'message': message,
        'result_exists': bool(result),
        'request_payload': request_payload,
    }


def _validate_platform_video_id(video_url: str, platform: str):
    if not str(video_url).strip():
        return None
    video_id = extract_video_id(video_url, platform)
    if platform == 'douyin' and not video_id:
        return R.error(
            msg='当前链接无法解析出抖音视频 ID，请确认链接完整，或使用 /video/xxx、短链、包含 modal_id 的分享链接',
            code=400,
            data={'reason': 'douyin_video_id_unparseable'},
        )
    return None


def _check_duplicate_response(data: VideoRequest):
    duplicate = _find_duplicate_task_with_fallback(data.video_url, data.platform)
    if not duplicate or data.force_regenerate or duplicate['task_id'] == data.task_id:
        return None

    status = duplicate.get('status')
    result_exists = bool(duplicate.get('result_exists'))
    if status in {TaskStatus.FAILED.value, TaskStatus.CANCELED.value, TaskStatus.RETRYABLE.value} and not result_exists:
        return None

    return R.error(
        msg='该视频以前已生成过笔记，请确认是否继续生成',
        code=409,
        data={
            'reason': 'duplicate_video_task',
            'duplicate_task': duplicate,
        },
    )


def _validate_model_override(provider_id: Optional[str], model_name: Optional[str]) -> Optional[str]:
    """校验批次重试/续跑的模型覆盖参数；返回错误信息，None 表示通过。

    覆盖必须成对出现，且 (provider_id, model_name) 必须是已登记的可用组合，
    否则重试只会再次失败。已关闭的供应商同样不允许作为覆盖目标。"""
    if not provider_id and not model_name:
        return None
    if bool(provider_id) != bool(model_name):
        return 'provider_id 与 model_name 必须同时提供才能覆盖模型'
    from app.db.model_dao import get_model_by_provider_and_name
    from app.services.provider import ProviderService

    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        return f'供应商不存在: {provider_id}'
    if provider.get('enabled') == 0:
        return f'供应商「{provider.get("name")}」已关闭，请选择其他已启用的供应商'
    if not get_model_by_provider_and_name(provider_id, model_name):
        return f'该供应商下不存在模型: {model_name}'
    return None


def _validate_provider_enabled(provider_id: Optional[str]):
    """在正式入队前同步校验供应商是否启用；已关闭则直接返回带可用模型列表的错误，
    让前端可以就地提示并引导用户选择新模型，避免任务跑到后台才失败。"""
    from app.services.provider import ProviderService
    from app.services.model import ModelService

    if not provider_id:
        return None
    provider = ProviderService.get_provider_by_id(provider_id)
    if provider and provider.get('enabled') == 0:
        available_models = []
        try:
            available_models = ModelService.get_all_models()
        except Exception as exc:
            logger.warning(f'加载可用模型失败: {exc}')
        return R.error(
            msg=f"模型供应商「{provider.get('name')}」已关闭，请选择其他已启用的供应商",
            code=ProviderErrorEnum.PROVIDER_DISABLED.code,
            data={
                'reason': 'provider_disabled',
                'provider_id': provider_id,
                'provider_name': provider.get('name'),
                'available_models': available_models,
            },
        )
    return None


def _build_retry_request(
    item: dict,
    row,
    *,
    provider_id: Optional[str] = None,
    model_name: Optional[str] = None,
) -> tuple[Optional[VideoRequest], Optional[str], Optional[str]]:
    payload = dict(item.get('request_payload') or {})
    original_video_url = payload.get('video_url')
    video_url = original_video_url if original_video_url is not None else item.get('source_url')
    payload.setdefault('platform', item.get('platform') or getattr(row, 'platform', None))
    # 重试/续跑必须复用数据库现有行。request_payload 里可能残留 task_id=null，
    # setdefault 无法覆盖 null（key 已存在），会让 VideoRequest.task_id 变成 None，
    # 从而在 _enqueue_note_task 里被当成新任务、插入新行。此处强制用 row.task_id。
    payload['task_id'] = row.task_id
    # 显式指定的模型覆盖优先级最高：用于旧配置失效（如供应商欠费）时切换重跑。
    if provider_id:
        payload['provider_id'] = provider_id
    if model_name:
        payload['model_name'] = model_name

    prefetched_transcript = payload.get('prefetched_transcript')
    video_id = extract_video_id(video_url or '', payload.get('platform')) if video_url else None
    canonical_video_url = _canonical_video_url(
        payload.get('platform'),
        video_id,
        video_url,
    )
    if canonical_video_url:
        if not (prefetched_transcript and not str(video_url or '').strip()):
            video_url = canonical_video_url
            payload['video_url'] = canonical_video_url
        else:
            payload['video_url'] = ''
    elif video_url:
        payload.setdefault('video_url', video_url)

    # Legacy rows often persisted explicit nulls for optional string fields.
    # Strip them so Pydantic can rebuild a valid retry request.
    for nullable_field in ('style', 'extras', 'prefetched_transcript'):
        if payload.get(nullable_field) is None:
            payload.pop(nullable_field, None)

    # Older batch rows were created before request_payload was persisted. The
    # source URL and platform are still enough to retry when current defaults
    # can provide the missing generation settings.
    if not payload.get('quality'):
        payload['quality'] = DownloadQuality.fast.value
    if not payload.get('model_name') or not payload.get('provider_id'):
        from app.services.model import ModelService

        try:
            enabled_models = ModelService.get_all_models()
        except Exception as exc:
            logger.warning(f'加载默认模型失败: {exc}')
            enabled_models = []
        if enabled_models:
            default_model = enabled_models[0]
            if not payload.get('model_name'):
                payload['model_name'] = default_model.get('model_name')
            if not payload.get('provider_id') and default_model.get('provider_id'):
                payload['provider_id'] = str(default_model['provider_id'])

    required_fields = ('platform', 'quality', 'model_name', 'provider_id')
    missing_fields = [field for field in required_fields if not payload.get(field)]
    if missing_fields:
        return None, video_url, f"missing_fields:{','.join(missing_fields)}"

    # 复用旧配置重试/续跑时，若绑定供应商已被关闭，不能静默沿用：标记 provider_disabled，
    # 交由前端提示用户选择新模型后重试（override 覆盖的情况由 _validate_model_override 把关）。
    _retry_provider_id = payload.get('provider_id')
    if _retry_provider_id:
        from app.services.provider import ProviderService
        _retry_provider = ProviderService.get_provider_by_id(_retry_provider_id)
        if _retry_provider and _retry_provider.get('enabled') == 0:
            return None, video_url, f"provider_disabled:{_retry_provider.get('name') or _retry_provider_id}"

    # Retries should accept transcript-only tasks that intentionally omit video_url.
    if not video_url and not payload.get('prefetched_transcript'):
        return None, None, 'missing_video_url'

    try:
        return VideoRequest(**payload), video_url, None
    except Exception as exc:
        return None, video_url, f'invalid_payload:{exc}'


def _release_inflight_task(task_id: str, task_key: Optional[tuple[str, str]] = None) -> None:
    with _video_task_lock:
        if task_key is not None:
            if _inflight_video_tasks.get(task_key) == task_id:
                _inflight_video_tasks.pop(task_key, None)
            return
        for key, active_task_id in list(_inflight_video_tasks.items()):
            if active_task_id == task_id:
                _inflight_video_tasks.pop(key, None)


def _enqueue_note_task(
    data: VideoRequest,
    background_tasks: BackgroundTasks,
    *,
    batch_id: Optional[str] = None,
    batch_name: Optional[str] = None,
):
    video_id = extract_video_id(data.video_url, data.platform)
    canonical_video_url = _canonical_video_url(data.platform, video_id, data.video_url)
    if canonical_video_url and canonical_video_url != data.video_url:
        data.video_url = canonical_video_url
    task_key = (data.platform, video_id or data.video_url)

    # Persist the task before publishing its in-flight marker. Otherwise a
    # concurrent request can receive a task_id that /history cannot resolve.
    with _video_task_lock:
        inflight_task_id = _inflight_video_tasks.get(task_key)
        if inflight_task_id and inflight_task_id != data.task_id:
            return R.error(
                msg='同一视频正在生成中，请等待当前任务完成后再试',
                code=300103,
                data={'task_id': inflight_task_id},
            )

        if data.task_id:
            task_id = data.task_id
            logger.info(f'重试模式，复用已有 task_id={task_id}')
        else:
            task_id = str(uuid.uuid4())

        existing_task = get_task_record(task_id) if data.task_id else None
        if not existing_task:
            persisted = insert_video_task(
                video_id=video_id or data.video_url,
                platform=data.platform,
                task_id=task_id,
                batch_id=batch_id,
                batch_name=batch_name,
                source_url=data.video_url,
                request_payload=data.model_dump(),
            )
        else:
            # Initial batch submissions used to leave request_payload empty because
            # retries reused the existing row without persisting the request.
            persisted = update_task_request_payload(task_id, data.model_dump())
            if persisted is False:
                persisted = existing_task

        if persisted is False:
            logger.error('任务记录持久化失败，拒绝发布任务 (task_id=%s)', task_id)
            return R.error(
                msg='任务记录保存失败，请稍后重试',
                code=500,
                data={'reason': 'task_persistence_failed'},
            )

        NoteGenerator()._update_status(task_id, TaskStatus.PENDING)

        if data.prefetched_transcript:
            try:
                _persist_prefetched_transcript(task_id, data.prefetched_transcript)
            except Exception as e:
                logger.warning(f'写入预取字幕失败 (task_id={task_id}): {e}')

        _inflight_video_tasks[task_key] = task_id

    try:
        background_tasks.add_task(
            run_note_task,
            task_id,
            data.video_url,
            data.platform,
            data.quality,
            data.link,
            data.screenshot,
            data.model_name,
            data.provider_id,
            data.format,
            data.style,
            data.extras,
            data.video_understanding,
            data.video_interval,
            data.grid_size,
            video_id,
        )
    except Exception:
        _release_inflight_task(task_id, task_key)
        raise
    logger.info('任务已入后台队列 (task_id=%s, platform=%s, video_url=%s)', task_id, data.platform, data.video_url)
    return R.success({'task_id': task_id, 'batch_id': batch_id})


def run_note_task(
    task_id: str,
    video_url: str,
    platform: str,
    quality: DownloadQuality,
    link: bool = False,
    screenshot: bool = False,
    model_name: str = None,
    provider_id: str = None,
    _format: list = None,
    style: str = None,
    extras: str = None,
    video_understanding: bool = False,
    video_interval=0,
    grid_size=[],
    video_id: Optional[str] = None,
):
    logger.info('run_note_task start (task_id=%s, platform=%s, video_url=%s, provider_id=%s)', task_id, platform, video_url, provider_id)
    if not model_name or not provider_id:
        raise HTTPException(status_code=400, detail='请选择模型和提供者')

    def _execute_note_task():
        return NoteGenerator().generate(
            video_url=video_url,
            platform=platform,
            quality=quality,
            task_id=task_id,
            model_name=model_name,
            provider_id=provider_id,
            link=link,
            _format=_format,
            style=style,
            extras=extras,
            screenshot=screenshot,
            video_understanding=video_understanding,
            video_interval=video_interval,
            grid_size=grid_size,
        )

    row = get_task_record(task_id)
    batch_id = getattr(row, 'batch_id', None)
    if batch_id and _batch_controls.get(batch_id) == 'CANCELED':
        NoteGenerator()._update_status(task_id, TaskStatus.CANCELED, message='批次任务已取消')
        return
    if batch_id and _batch_controls.get(batch_id) == 'PAUSED':
        NoteGenerator()._update_status(task_id, TaskStatus.PAUSED, message='批次任务已暂停')
        return

    task_key = (platform, video_id or video_url)
    try:
        logger.info(f'任务进入执行队列 (task_id={task_id})')
        note = task_serial_executor.run(_execute_note_task)
        logger.info(f'Note generated: {task_id}')
        if not note or not note.markdown:
            logger.warning(f'任务 {task_id} 执行失败，跳过保存')
            return
        save_note_to_file(task_id, note)
        update_task_title(task_id, getattr(note.audio_meta, 'title', None))

        try:
            from app.services.vector_store import VectorStoreManager

            VectorStoreManager().index_task(task_id)
        except Exception as e:
            logger.warning(f'向量索引失败（不影响笔记）: {e}')
    finally:
        with _video_task_lock:
            if _inflight_video_tasks.get(task_key) == task_id:
                _inflight_video_tasks.pop(task_key, None)


@router.post('/delete_task')
def delete_task(data: DeleteTaskRequest):
    try:
        _release_inflight_task(data.task_id)
        if not _delete_task_data(data.task_id):
            return R.error(msg='任务不存在')
        return R.success(msg='删除成功')
    except Exception as e:
        return R.error(msg=str(e))


@router.post('/detach_batch_tasks')
def detach_batch_tasks(data: BatchActionRequest):
    try:
        count = clear_batch_by_id(data.batch_id)
        _batch_controls.pop(data.batch_id)
        if count <= 0:
            return R.error(msg='批次不存在')
        return R.success(data={'batch_id': data.batch_id, 'count': count}, msg='批次任务已移出批次视图')
    except Exception as e:
        return R.error(msg=str(e))


@router.post('/rename_batch')
def rename_batch_endpoint(data: dict):
    batch_id = data.get('batch_id', '').strip()
    new_name = data.get('batch_name', '').strip()
    if not batch_id:
        return R.error(msg='batch_id 不能为空', code=400)
    if not new_name:
        return R.error(msg='新名称不能为空', code=400)
    success = rename_batch(batch_id, new_name)
    if not success:
        return R.error(msg='项目不存在', code=404)
    return R.success(msg='重命名成功')


@router.post('/move_task_to_batch')
def move_task_to_batch_endpoint(data: dict):
    task_id = data.get('task_id', '').strip()
    batch_id = data.get('batch_id', '').strip()
    batch_name = data.get('batch_name', '').strip()
    if not task_id:
        return R.error(msg='task_id 不能为空', code=400)
    if not batch_id or not batch_name:
        return R.error(msg='batch_id 和 batch_name 不能为空', code=400)
    success = move_task_to_batch(task_id, batch_id, batch_name)
    if not success:
        return R.error(msg='任务不存在', code=404)
    return R.success(msg='已移动到项目')


@router.get('/all_batches')
def get_all_batches_endpoint():
    batches = get_all_batches()
    return R.success(data=batches)


@router.post('/upload')
async def upload(file: UploadFile = File(...)):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_location = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_location, 'wb+') as f:
        f.write(await file.read())

    return R.success({'url': f'/uploads/{file.filename}'})


@router.post('/generate_note')
def generate_note(data: VideoRequest, background_tasks: BackgroundTasks):
    try:
        logger.info('收到 generate_note 请求 (platform=%s, video_url=%s, provider_id=%s)', data.platform, data.video_url, data.provider_id)
        readiness_error = _check_transcriber_readiness(skip_check=bool(data.prefetched_transcript))
        if readiness_error:
            return readiness_error

        validation_error = _validate_platform_video_id(data.video_url, data.platform)
        if validation_error:
            return validation_error

        duplicate_resp = _check_duplicate_response(data)
        if duplicate_resp:
            return duplicate_resp
        # 同步拦截已关闭的供应商，立即给出可选择的可用模型，避免任务跑到后台才失败。
        enabled_error = _validate_provider_enabled(data.provider_id)
        if enabled_error:
            return enabled_error
        return _enqueue_note_task(
            data,
            background_tasks,
            batch_id=data.batch_id or None,
            batch_name=data.batch_name or None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/batch_check_duplicates')
def batch_check_duplicates(data: BatchVideoRequest):
    """批量链接与历史笔记的预检：只对比不创建。

    对每个链接：校验平台 -> 查历史重复 -> 返回 comparison 结果，
    由前端展示后由用户二次确认，再调用 /generate_notes_batch 真正创建。
    """
    results = []
    seen = set()
    for url in data.video_urls:
        url = str(url or '').strip()
        if not url or url in seen:
            continue
        seen.add(url)

        validation_error = _validate_platform_video_id(url, data.platform)
        if validation_error:
            payload = json.loads(validation_error.body.decode('utf-8'))
            results.append({
                'video_url': url,
                'valid': False,
                'code': payload.get('code'),
                'msg': payload.get('msg'),
                'reason': (payload.get('data') or {}).get('reason'),
                'duplicate_task': None,
            })
            continue

        duplicate = _find_duplicate_task_with_fallback(url, data.platform)
        # 与 _check_duplicate_response 保持一致的判定：失败的且无结果的历史不视为重复
        needs_confirmation = False
        if duplicate:
            status = duplicate.get('status')
            result_exists = bool(duplicate.get('result_exists'))
            if status in {TaskStatus.FAILED.value, TaskStatus.CANCELED.value, TaskStatus.RETRYABLE.value} and not result_exists:
                duplicate = None
            else:
                needs_confirmation = True

        results.append({
            'video_url': url,
            'valid': True,
            'code': 0,
            'msg': '',
            'reason': None,
            'duplicate_task': duplicate,
            'needs_confirmation': needs_confirmation,
        })
    return R.success({'results': results})


@router.post('/generate_notes_batch')
def generate_notes_batch(data: BatchVideoRequest, background_tasks: BackgroundTasks):
    try:
        readiness_error = _check_transcriber_readiness()
        if readiness_error:
            return readiness_error

        # 同步拦截已关闭的供应商，立即给出可选择的可用模型，避免批量任务跑到后台才失败。
        enabled_error = _validate_provider_enabled(data.provider_id)
        if enabled_error:
            return enabled_error

        batch_id = data.batch_id or str(uuid.uuid4())
        batch_name = data.batch_name or _make_batch_name()
        items = []
        confirmed_urls = set(data.duplicate_confirm_urls or [])
        confirmed_keys = {key for key in (_normalize_duplicate_key(url, data.platform) for url in confirmed_urls) if key}
        seen_batch_keys = set()
        for url in data.video_urls:
            single = VideoRequest(
                video_url=url,
                platform=data.platform,
                quality=data.quality,
                screenshot=data.screenshot,
                link=data.link,
                model_name=data.model_name,
                provider_id=data.provider_id,
                format=data.format,
                style=data.style,
                extras=data.extras,
                video_understanding=data.video_understanding,
                video_interval=data.video_interval,
                grid_size=data.grid_size,
                force_regenerate=data.force_regenerate,
            )
            validation_error = _validate_platform_video_id(single.video_url, single.platform)
            if validation_error:
                payload = json.loads(validation_error.body.decode('utf-8'))
                items.append({
                    'video_url': url,
                    'code': payload.get('code'),
                    'msg': payload.get('msg'),
                    'reason': (payload.get('data') or {}).get('reason'),
                })
                continue

            normalized_url_key = _normalize_duplicate_key(url, data.platform)
            batch_key = normalized_url_key or url
            if batch_key in seen_batch_keys:
                continue
            seen_batch_keys.add(batch_key)
            duplicate_resp = _check_duplicate_response(single)
            if duplicate_resp and data.duplicate_strategy == 'skip':
                payload = json.loads(duplicate_resp.body.decode('utf-8'))
                duplicate_data = payload.get('data') or {}
                items.append({
                    'video_url': url,
                    'code': payload.get('code'),
                    'msg': '检测到重复历史，已跳过',
                    'duplicate_task': duplicate_data.get('duplicate_task'),
                    'skipped': True,
                })
                continue
            if duplicate_resp and data.duplicate_strategy == 'confirm' and url not in confirmed_urls and normalized_url_key not in confirmed_keys:
                payload = json.loads(duplicate_resp.body.decode('utf-8'))
                duplicate_data = payload.get('data') or {}
                items.append({
                    'video_url': url,
                    'code': payload.get('code'),
                    'msg': payload.get('msg'),
                    'duplicate_task': duplicate_data.get('duplicate_task'),
                    'needs_confirmation': True,
                })
                continue
            if duplicate_resp and (data.duplicate_strategy == 'continue_all' or url in confirmed_urls or normalized_url_key in confirmed_keys):
                single.force_regenerate = True
            resp = _enqueue_note_task(single, background_tasks, batch_id=batch_id, batch_name=batch_name)
            payload = json.loads(resp.body.decode('utf-8'))
            item = payload.get('data') or {}
            item['video_url'] = url
            item['code'] = payload.get('code')
            item['msg'] = payload.get('msg')
            items.append(item)
        return R.success({'batch_id': batch_id, 'batch_name': batch_name, 'tasks': items})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/batch_status/{batch_id}')
def get_batch_status(batch_id: str):
    rows = list_tasks_by_batch(batch_id)
    items = [_build_task_item(row.task_id, row=row) for row in rows]
    summary = {
        'total': len(items),
        'success': sum(1 for item in items if item['status'] == TaskStatus.SUCCESS.value),
        'failed': sum(1 for item in items if item['status'] in {TaskStatus.FAILED.value, TaskStatus.RETRYABLE.value}),
        'paused': sum(1 for item in items if item['status'] == TaskStatus.PAUSED.value),
        'canceled': sum(1 for item in items if item['status'] == TaskStatus.CANCELED.value),
    }
    summary['pending'] = summary['total'] - summary['success'] - summary['failed'] - summary['paused'] - summary['canceled']
    batch_name = next((item.get('batch_name') for item in items if item.get('batch_name')), None)
    control_state = _batch_controls.get(batch_id)
    return R.success({'batch_id': batch_id, 'batch_name': batch_name, 'control_state': control_state, 'summary': summary, 'items': items})


@router.post('/batch_pause')
def pause_batch(data: BatchActionRequest):
    _batch_controls.set(data.batch_id, 'PAUSED')
    return R.success({'batch_id': data.batch_id, 'control_state': 'PAUSED'})


@router.post('/batch_resume')
def resume_batch(data: BatchResumeRequest, background_tasks: BackgroundTasks):
    override_error = _validate_model_override(data.provider_id, data.model_name)
    if override_error:
        return R.error(msg=override_error, code=400)
    _batch_controls.set(data.batch_id, 'RUNNING')
    rows = list_tasks_by_batch(data.batch_id)
    resumed_items = []
    skipped_items = []
    target_statuses = {TaskStatus.PAUSED.value}
    if data.include_pending:
        target_statuses.add(TaskStatus.PENDING.value)
    limit = data.limit if data.limit and data.limit > 0 else None

    for row in rows:
        item = _build_task_item(row.task_id, row=row)
        if item['status'] not in target_statuses:
            continue
        resume_request, video_url, error_reason = _build_retry_request(
            item,
            row,
            provider_id=data.provider_id,
            model_name=data.model_name,
        )
        if not resume_request:
            skipped_items.append({
                'task_id': row.task_id,
                'video_url': video_url,
                'reason': error_reason,
            })
            continue
        response = _enqueue_note_task(
            resume_request,
            background_tasks,
            batch_id=row.batch_id,
            batch_name=getattr(row, 'batch_name', None),
        )
        payload_data = json.loads(response.body.decode('utf-8'))
        if payload_data.get('code') in {0, 200}:
            resumed_items.append({
                'task_id': row.task_id,
                'video_url': video_url,
            })
        else:
            reason = (payload_data.get('data') or {}).get('reason') or payload_data.get('msg')
            if reason == 'duplicate_video_task' and (payload_data.get('data') or {}).get('duplicate_task'):
                resumed_items.append({
                    'task_id': row.task_id,
                    'video_url': video_url,
                    'duplicate_task_id': (payload_data.get('data') or {}).get('duplicate_task', {}).get('task_id'),
                })
            else:
                skipped_items.append({
                    'task_id': row.task_id,
                    'video_url': video_url,
                    'reason': reason,
                })
        if limit and len(resumed_items) >= limit:
            break
    return R.success({
        'batch_id': data.batch_id,
        'control_state': 'RUNNING',
        'resumed': resumed_items,
        'skipped': skipped_items,
        'count': len(resumed_items),
    })


@router.post('/batch_cancel')
def cancel_batch(data: BatchActionRequest):
    _batch_controls.set(data.batch_id, 'CANCELED')
    rows = list_tasks_by_batch(data.batch_id)
    for row in rows:
        status, _ = _load_task_status(row.task_id)
        if status in {TaskStatus.SUCCESS.value, TaskStatus.FAILED.value, TaskStatus.CANCELED.value, TaskStatus.RETRYABLE.value}:
            continue
        NoteGenerator()._update_status(row.task_id, TaskStatus.CANCELED, message='批次任务已取消')
    return R.success({'batch_id': data.batch_id, 'control_state': 'CANCELED'})


@router.post('/batch_clear_failed')
def clear_failed_batch_tasks(data: BatchActionRequest):
    rows = list_tasks_by_batch(data.batch_id)
    cleared_task_ids = []
    for row in rows:
        item = _build_task_item(row.task_id, row=row)
        if item['status'] not in {TaskStatus.FAILED.value, TaskStatus.RETRYABLE.value}:
            continue
        if _delete_task_data(row.task_id):
            cleared_task_ids.append(row.task_id)
    return R.success({
        'batch_id': data.batch_id,
        'cleared': cleared_task_ids,
        'count': len(cleared_task_ids),
    })


@router.post('/batch_retry_failed')
def retry_failed_batch_tasks(data: BatchRetryFailedRequest, background_tasks: BackgroundTasks):
    override_error = _validate_model_override(data.provider_id, data.model_name)
    if override_error:
        return R.error(msg=override_error, code=400)
    rows = list_tasks_by_batch(data.batch_id)
    retried_items = []
    skipped_items = []
    target_task_id = data.task_id
    for row in rows:
        if target_task_id and row.task_id != target_task_id:
            continue
        item = _build_task_item(row.task_id, row=row)
        if item['status'] not in {TaskStatus.FAILED.value, TaskStatus.RETRYABLE.value}:
            continue
        retry_request, video_url, error_reason = _build_retry_request(
            item,
            row,
            provider_id=data.provider_id,
            model_name=data.model_name,
        )
        if not retry_request:
            skipped_items.append({
                'task_id': row.task_id,
                'video_url': video_url,
                'reason': error_reason,
            })
            continue
        response = _enqueue_note_task(
            retry_request,
            background_tasks,
            batch_id=row.batch_id,
            batch_name=getattr(row, 'batch_name', None),
        )
        payload_data = json.loads(response.body.decode('utf-8'))
        if payload_data.get('code') in {0, 200}:
            retried_items.append({
                'task_id': row.task_id,
                'video_url': video_url,
            })
        else:
            skipped_items.append({
                'task_id': row.task_id,
                'video_url': video_url,
                'reason': (payload_data.get('data') or {}).get('reason') or payload_data.get('msg'),
            })
    if retried_items:
        _batch_controls.set(data.batch_id, 'RUNNING')
    return R.success({
        'batch_id': data.batch_id,
        'retried': retried_items,
        'skipped': skipped_items,
        'count': len(retried_items),
    })


def _looks_like_placeholder_title(title: Optional[str], *, video_id: Optional[str] = None, source_url: Optional[str] = None) -> bool:
    """标题为空，或只是拿视频 ID / 链接充当标题时，视为「未按视频标题命名」。"""
    text = str(title or '').strip()
    if not text:
        return True
    placeholders = {str(video_id or '').strip(), str(source_url or '').strip()}
    placeholders.discard('')
    return text in placeholders


def _fetch_video_title_online(platform: Optional[str], video_url: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """在线获取视频标题（不下载视频），返回 (标题, 失败原因)。"""
    url = str(video_url or '').strip()
    if not url.lower().startswith(('http://', 'https://')):
        return None, '缺少可用的视频链接'
    try:
        if platform == 'douyin':
            # 抖音必须复用下载器的 Cookie / 请求配置，否则报 Fresh cookies
            import tempfile

            from app.downloaders.douyin_downloader import DouyinDownloader
            info = DouyinDownloader()._extract_info_with_ytdlp(url, download=False, output_dir=tempfile.gettempdir())
        else:
            import yt_dlp
            from app.downloaders.yt_dlp_options import apply_ffmpeg_location

            opts = {
                'skip_download': True,
                'quiet': True,
                'no_warnings': True,
                'noplaylist': True,
                'socket_timeout': 15,
            }
            if platform == 'bilibili':
                opts['http_headers'] = {'Referer': 'https://www.bilibili.com'}
            try:
                apply_ffmpeg_location(opts)
            except Exception:
                pass
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        title = (info or {}).get('title')
        title = str(title).strip() or None
        return (title, None if title else '未返回有效标题')
    except Exception as exc:
        logger.warning('在线获取视频标题失败 (%s): %s', url, exc)
        message = str(exc)
        if 'Fresh cookies' in message or 'Cookie 已失效' in message:
            return None, '抖音 Cookie 已失效，请在设置中更新最新 Cookie 后重试'
        return None, message[:120]


def _rename_markdown_to_title(task_id: str, title: str) -> bool:
    legacy_path = note_markdown_path(task_id)
    titled_path = note_markdown_path(task_id, title)
    if legacy_path == titled_path:
        return False
    try:
        if legacy_path.exists():
            titled_path.write_text(legacy_path.read_text(encoding='utf-8'), encoding='utf-8')
            legacy_path.unlink()
            return True
    except Exception as exc:
        logger.warning('重命名 markdown 文件失败 (task_id=%s): %s', task_id, exc)
    return False


def _sync_note_json_title(task_id: str, title: str) -> bool:
    """把修复后的标题同步回笔记结果 JSON 的 audio_meta.title。

    历史卡片显示的名称优先取该字段；不同步的话前端刷新后仍会显示旧占位名。
    """
    result_path = note_json_path(task_id)
    if not result_path.exists():
        return False
    try:
        content = json.loads(result_path.read_text(encoding='utf-8'))
        audio_meta = content.get('audio_meta')
        if not isinstance(audio_meta, dict):
            return False
        audio_meta['title'] = title
        result_path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding='utf-8')
        return True
    except Exception as exc:
        logger.warning('同步笔记 JSON 标题失败 (task_id=%s): %s', task_id, exc)
        return False


@router.post('/fix_note_titles')
def fix_note_titles(data: FixNoteTitlesRequest):
    """把未按视频标题命名的笔记统一重命名为视频标题。

    判定口径：DB 标题或笔记 JSON 的 audio_meta.title 任一为空、等于视频 ID
    或等于来源链接的记录视为「未命名」。优先使用本地已缓存的真实标题；
    本地缺失且 fetch_online 开启时，再通过 yt-dlp 在线补取（不下载视频）。
    """
    rows = list_all_tasks()
    fixed_local = []
    fixed_online = []
    failed = []

    for row in rows:
        row_video_id = getattr(row, 'video_id', None)
        row_source_url = getattr(row, 'source_url', None)
        task_id = row.task_id

        result_content = _load_note_result(task_id)
        audio_meta = (result_content.get('audio_meta') or {}) if isinstance(result_content, dict) else {}
        json_title = str(audio_meta.get('title') or '').strip() or None

        db_title = getattr(row, 'title', None)
        online_error: Optional[str] = None
        db_needs_fix = _looks_like_placeholder_title(db_title, video_id=row_video_id, source_url=row_source_url)
        json_needs_fix = _looks_like_placeholder_title(json_title, video_id=row_video_id, source_url=row_source_url)
        if not db_needs_fix and not json_needs_fix:
            continue

        # 候选标题优先级：本地 JSON 真实标题 > DB 真实标题 > 在线补取
        db_title_clean = str(db_title or '').strip() or None
        candidate = None
        if not _looks_like_placeholder_title(json_title, video_id=row_video_id, source_url=row_source_url):
            candidate = json_title
        elif not _looks_like_placeholder_title(db_title_clean, video_id=row_video_id, source_url=row_source_url):
            candidate = db_title_clean
        if not candidate and data.fetch_online:
            candidate, online_error = _fetch_video_title_online(getattr(row, 'platform', None), getattr(row, 'source_url', None) or row_source_url)

        if candidate and _looks_like_placeholder_title(candidate, video_id=row_video_id, source_url=row_source_url):
            candidate = None

        if not candidate:
            failed.append({'task_id': task_id, 'reason': online_error or '未找到可用标题'})
            continue

        ok = True
        if db_needs_fix and not update_task_title(task_id, candidate):
            failed.append({'task_id': task_id, 'reason': 'update_failed'})
            ok = False
        if ok and json_needs_fix:
            _sync_note_json_title(task_id, candidate)
            _rename_markdown_to_title(task_id, candidate)

        if not ok:
            continue
        entry = {'task_id': task_id, 'title': candidate}
        if data.fetch_online and db_needs_fix and json_title is None:
            fixed_online.append(entry)
        else:
            fixed_local.append(entry)

    total_fixed = len(fixed_local) + len(fixed_online)
    logger.info('fix_note_titles 完成: 共检查 %s 条, 修复 %s 条 (本地 %s / 在线 %s), 失败 %s 条',
                len(rows), total_fixed, len(fixed_local), len(fixed_online), len(failed))
    return R.success({
        'total_checked': len(rows),
        'fixed_count': total_fixed,
        'local_fixed': fixed_local,
        'online_fixed': fixed_online,
        'failed': failed,
    })


@router.get('/history')
def get_history(limit: int = 100, offset: int = 0, include_pending: bool = True, batch_id: str | None = None):
    items = []
    target_offset = max(offset, 0)
    target_limit = max(limit, 1)
    fetch_limit = max(target_limit, 20)
    fetch_offset = 0

    while len(items) < target_offset + target_limit:
        rows = list_recent_tasks(fetch_limit, offset=fetch_offset, batch_id=batch_id)
        if not rows:
            break
        fetch_offset += len(rows)

        for row in rows:
            item = _build_task_item(row.task_id, row=row)
            if not item['result'] and not include_pending:
                continue
            # Failed tasks are kept in the list (with their failure message) so the
            # frontend can render a failed card with a retry action instead of the
            # task silently disappearing from the history window.
            items.append(item)

    items.sort(
        key=lambda item: (
            *_history_sort_priority(item),
            -(datetime.fromisoformat(item['created_at']).timestamp() if item.get('created_at') else 0.0),
        )
    )

    visible_items = items[target_offset: target_offset + target_limit]
    return R.success(visible_items)


@router.get('/history/{task_id}')
def get_history_task(task_id: str):
    row = get_task_record(task_id)
    if not row:
        return R.error(msg='任务不存在', code=404)
    return R.success(_build_task_item(task_id, row=row))


@router.get('/task_status/{task_id}')
def get_task_status(task_id: str):
    status_path = task_status_path(task_id)
    result_path = note_json_path(task_id)
    row = get_task_record(task_id)

    # Result file is the strongest signal that the task finished, even if
    # a stale status file was left behind during the summarize/save handoff.
    if result_path.exists():
        with result_path.open('r', encoding='utf-8') as f:
            result_content = json.load(f)
        return R.success({
            'status': TaskStatus.SUCCESS.value,
            'result': result_content,
            'task_id': task_id,
        })

    if status_path.exists():
        with status_path.open('r', encoding='utf-8') as f:
            status_content = json.load(f)

        status = status_content.get('status')
        message = _resolve_failed_message(status, status_content.get('message', ''), row=row)

        if status == TaskStatus.SUCCESS.value:
            return R.success({
                'status': TaskStatus.PENDING.value,
                'message': '任务完成，但结果文件未找到',
                'task_id': task_id,
            })

        if status == TaskStatus.FAILED.value:
            # 失败状态也走 HTTP 200 + body 内 status 字段：
            # 客户端轮询（useTaskPolling / 扩展 popup）按 body.status 判断，
            # HTTP 500 会让 axios throw，轮询 catch 后状态永远停在"等待中"。
            return R.success({
                'status': TaskStatus.FAILED.value,
                'message': message or '任务失败',
                'task_id': task_id,
            })

        return R.success({
            'status': status,
            'message': message,
            'task_id': task_id,
        })

    if row is not None:
        fallback_status, fallback_message = _fallback_task_status(task_id, row=row)
        if fallback_status == TaskStatus.FAILED.value:
            return R.success({
                'status': TaskStatus.FAILED.value,
                'message': fallback_message or '任务失败',
                'task_id': task_id,
            })
        return R.success({
            'status': fallback_status,
            'message': fallback_message,
            'task_id': task_id,
        })

    return R.error('任务不存在', code=404)


@router.get('/image_proxy')
async def image_proxy(request: Request, url: str):
    headers = {
        'Referer': 'https://www.bilibili.com/',
        'User-Agent': request.headers.get('User-Agent', ''),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail='图片获取失败')

            content_type = resp.headers.get('Content-Type', 'image/jpeg')
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type=content_type,
                headers={
                    'Cache-Control': 'public, max-age=86400',
                    'Content-Type': content_type,
                },
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
