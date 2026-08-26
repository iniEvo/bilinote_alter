# app/routers/artifacts.py
"""生成物（笔记生成过程的中间/最终产物）存储信息与清理接口。

设计要点：
- 目录白名单：只允许清理本模块登记过的目录，且路径一律经 resolve_app_path 锚定，
  绝不接受前端传来的任意路径。
- deletable=False 的生成物（最终 Markdown 笔记）后端直接拒绝清理，双保险。
"""
import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from app.utils.logger import get_logger
from app.utils.output_paths import JSON_OUTPUT_DIR, NOTE_OUTPUT_DIR
from app.utils.path_helper import APP_ROOT, resolve_app_path
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


def _dir(path: str) -> Path:
    return Path(resolve_app_path(path))


# 生成物登记表。deletable=False 的条目清理接口会直接拒绝。
ARTIFACT_REGISTRY = [
    {
        "key": "video_audio_cache",
        "name": "视频 / 音频缓存",
        "description": "生成笔记时下载的源视频（.mp4）与提取的音频（.mp3），可重新下载，删除后不影响已生成的笔记",
        "dirs": [str(_dir("data/data"))],
        "deletable": True,
        "warning": None,
    },
    {
        "key": "screenshots",
        "name": "笔记配图截图",
        "description": "从视频中截取并插入笔记的截图（.jpg/.png），由后端 /static 静态服务对外提供",
        "dirs": [str(_dir("static/screenshots"))],
        "deletable": True,
        "warning": "清理后，已有笔记中的截图链接将失效、图片无法显示",
    },
    {
        "key": "json_intermediate",
        "name": "转写与任务中间产物（JSON）",
        "description": "音频转写文本、任务状态、GPT 断点续跑 checkpoint 等中间 JSON 文件",
        "dirs": [str(JSON_OUTPUT_DIR)],
        "deletable": True,
        "warning": "清理后历史任务状态丢失，无法基于旧任务重新导出/续跑，需重新生成",
    },
    {
        "key": "frame_artifacts",
        "name": "视频抽帧产物",
        "description": "视频关键帧抽取（output_frames）与九宫格拼图（grid_output）等图像分析中间产物",
        "dirs": [str(_dir("data/output_frames")), str(_dir("data/grid_output"))],
        "deletable": True,
        "warning": None,
    },
    {
        "key": "uploads",
        "name": "本地上传文件",
        "description": "通过本地上传功能提交的视频源文件，由后端 /uploads 静态服务提供访问",
        "dirs": [str(_dir("uploads"))],
        "deletable": True,
        "warning": "清理后，引用这些本地文件的历史记录将无法再访问源视频",
    },
    {
        "key": "markdown_notes",
        "name": "Markdown 笔记成品",
        "description": "LLM 生成的最终 Markdown 笔记文件，属于用户成果而非缓存",
        "dirs": [str(NOTE_OUTPUT_DIR)],
        "deletable": False,
        "warning": "最终成果，不支持在此批量清理；如需删除请到笔记列表逐条删除",
    },
]

# key -> 已解析目录列表（用于执行清理时的白名单校验）
_KEY_TO_DIRS = {item["key"]: [Path(d) for d in item["dirs"]] for item in ARTIFACT_REGISTRY}


def _stat_dirs(dirs: List[Path]) -> tuple[int, int]:
    """统计目录列表内所有文件的数量与总字节数，返回 (总字节数, 文件数)。目录不存在按 0 计。"""
    total_size = 0
    file_count = 0
    for d in dirs:
        if not d.exists():
            continue
        for p in d.rglob("*"):
            try:
                if p.is_file():
                    total_size += p.stat().st_size
                    file_count += 1
            except OSError:
                # 文件被占用/竞态删除时跳过，不让单个文件拖垮整体统计
                continue
    return total_size, file_count


def _clear_dir_contents(d: Path) -> tuple[int, int]:
    """清空目录内容（保留目录本身），返回 (释放字节数, 删除文件数)。"""
    freed, removed = 0, 0
    if not d.exists():
        return freed, removed
    for entry in list(d.iterdir()):
        try:
            if entry.is_dir() and not entry.is_symlink():
                size, count = _stat_dirs([entry])
                shutil.rmtree(entry)
                freed += size
                removed += count
            else:
                size = entry.stat().st_size
                entry.unlink()
                freed += size
                removed += 1
        except OSError as e:
            logger.warning(f"清理跳过 {entry}: {e}")
            continue
    return freed, removed


@router.get("/artifacts")
def list_artifacts():
    items = []
    for item in ARTIFACT_REGISTRY:
        dirs = _KEY_TO_DIRS[item["key"]]
        size_bytes, file_count = _stat_dirs(dirs)
        existing = [str(d) for d in dirs if d.exists()]
        items.append({
            **item,
            "paths": existing,
            "file_count": file_count,
            "size_bytes": size_bytes,
        })
    return R.success(data={"artifacts": items})


class CleanupRequest(BaseModel):
    keys: List[str]


@router.post("/artifacts/cleanup")
def cleanup_artifacts(data: CleanupRequest):
    results = []
    known_keys = {item["key"] for item in ARTIFACT_REGISTRY}
    unknown = [k for k in data.keys if k not in known_keys]
    if unknown:
        return R.error(msg=f"未知的生成物类型: {', '.join(unknown)}", code=400)

    for key in data.keys:
        meta = next(item for item in ARTIFACT_REGISTRY if item["key"] == key)
        if not meta["deletable"]:
            results.append({"key": key, "status": "refused", "msg": "该生成物不允许批量清理"})
            continue
        freed, removed = 0, 0
        for d in _KEY_TO_DIRS[key]:
            f, r = _clear_dir_contents(d)
            freed += f
            removed += r
        logger.info(f"[artifacts] 清理 {key}: 删除 {removed} 个文件，释放 {freed} 字节")
        results.append({
            "key": key,
            "status": "done",
            "removed_files": removed,
            "freed_bytes": freed,
            "msg": f"已删除 {removed} 个文件，释放 {freed / 1024 / 1024:.2f} MB",
        })
    return R.success(data={"results": results})
