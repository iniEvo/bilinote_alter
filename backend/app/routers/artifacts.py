# app/routers/artifacts.py
"""生成物（笔记生成过程的中间/最终产物）存储信息与清理接口。

产物分层与前端展示笔记的数据链路对齐（前端展示笔记以 json_results/{task_id}.json
的 markdown 字段为唯一依据，note_results/*.md 只是派生出的导出副本）：

- 笔记成品 JSON（json_results/{task_id}.json）：前端展示笔记的唯一依据，不可批量清理；
- Markdown 导出副本（note_results/*.md）：可随时从笔记 JSON 重建，删除不影响前端展示；
- 转录文本 / 任务状态 / 音频元数据等中间 JSON：可清理，但会连带失去相应能力；
- 视频音频缓存、截图、抽帧、上传文件等纯缓存：可安全清理。

清理粒度支持两种目标（防误删权威数据的双保险）：
- dirs：目录，清理时清空目录内容；
- globs：glob 模式（锚定到后端目录），只删除匹配文件；exclude_globs 用于从 globs 结果中排除。
"""
import glob
import shutil
from pathlib import Path
from typing import List, Tuple

from fastapi import APIRouter
from pydantic import BaseModel

from app.utils.logger import get_logger
from app.utils.output_paths import JSON_OUTPUT_DIR, NOTE_OUTPUT_DIR
from app.utils.path_helper import resolve_app_path
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


def _dir(path: str) -> Path:
    return Path(resolve_app_path(path))


# 生成物登记表。
# - dirs：目录（整目录内容清理）
# - globs / exclude_globs：glob 文件模式，glob 结果中排除 exclude_globs 命中的文件
# - deletable=False 的条目清理接口会直接拒绝，双保险。
ARTIFACT_REGISTRY = [
    {
        "key": "note_json",
        "name": "笔记成品（JSON）",
        "description": "每个任务最终生成的笔记 JSON（{task_id}.json），内含 Markdown 全文与音频元数据，"
        "是前端展示笔记、历史记录与导出 PDF/DOCX 的唯一依据",
        "globs": [f"{JSON_OUTPUT_DIR}/*.json"],
        "exclude_globs": [
            f"{JSON_OUTPUT_DIR}/*_audio.json",
            f"{JSON_OUTPUT_DIR}/*_transcript.json",
            f"{JSON_OUTPUT_DIR}/*.status.json",
            f"{JSON_OUTPUT_DIR}/*.gpt.checkpoint.json",
        ],
        "deletable": False,
        "warning": "这是前端展示笔记的唯一依据，删除后所有笔记在前端将无法显示",
    },
    {
        "key": "markdown_notes",
        "name": "Markdown 导出副本（.md）",
        "description": "从笔记 JSON 的 markdown 字段落盘的纯文本副本（note_results/*.md），仅用于导出或本地打开；"
        "删除不影响前端展示，可随时从笔记 JSON 重新生成",
        "dirs": [str(NOTE_OUTPUT_DIR)],
        "deletable": True,
        "warning": "删除后前端笔记正文仍可正常查看，但本地 .md 副本需要重新导出才会生成",
    },
    {
        "key": "transcript_json",
        "name": "音频转写文本（JSON）",
        "description": "每个视频的语音转写全文与分段（{task_id}_transcript.json），供「AI 问答（RAG）」检索使用",
        "globs": [f"{JSON_OUTPUT_DIR}/*_transcript.json"],
        "deletable": True,
        "warning": "删除后，相关笔记的 AI 问答能力失效，需重新跑对应任务才能恢复",
    },
    {
        "key": "task_state_json",
        "name": "任务状态与中间 JSON",
        "description": "任务状态（*.status.json）、音频元数据（*_audio.json）、GPT 断点 checkpoint 等中间文件",
        "globs": [
            f"{JSON_OUTPUT_DIR}/*.status.json",
            f"{JSON_OUTPUT_DIR}/*_audio.json",
            f"{JSON_OUTPUT_DIR}/*.gpt.checkpoint.json",
        ],
        "deletable": True,
        "warning": "删除后历史任务状态（成功/失败标记）丢失会回退，断点续跑失效",
    },
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
]

_KEY_TO_META = {item["key"]: item for item in ARTIFACT_REGISTRY}


def _stat_dirs(dirs: List[Path]) -> Tuple[int, int]:
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
                continue
    return total_size, file_count


def _clear_dir_contents(d: Path) -> Tuple[int, int]:
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


def _resolve_glob_files(globs: List[str], exclude_globs: List[str]) -> set[Path]:
    """解析 glob 文件模式为文件集合，减去 exclude_globs 命中的文件。"""
    included: set[Path] = set()
    for pattern in globs:
        for f in glob.glob(resolve_app_path(pattern)):
            p = Path(f)
            if p.is_file():
                included.add(p)
    excluded: set[Path] = set()
    for pattern in exclude_globs:
        for f in glob.glob(resolve_app_path(pattern)):
            excluded.add(Path(f))
    return included - excluded


def _stat_globs(globs: List[str], exclude_globs: List[str]) -> Tuple[int, int]:
    total_size = 0
    file_count = 0
    for p in _resolve_glob_files(globs, exclude_globs):
        try:
            total_size += p.stat().st_size
            file_count += 1
        except OSError:
            continue
    return total_size, file_count


def _clear_globs(globs: List[str], exclude_globs: List[str]) -> Tuple[int, int]:
    freed, removed = 0, 0
    for p in _resolve_glob_files(globs, exclude_globs):
        try:
            freed += p.stat().st_size
            p.unlink()
            removed += 1
        except OSError as e:
            logger.warning(f"清理跳过 {p}: {e}")
            continue
    return freed, removed


def _dir_paths(item) -> List[Path]:
    return [Path(resolve_app_path(d)) for d in item.get("dirs", [])]


def _display_paths(item) -> List[str]:
    """给前端展示的目标位置：目录给绝对路径，glob 给绝对模式。"""
    paths = [resolve_app_path(d) for d in item.get("dirs", [])]
    paths.extend(resolve_app_path(g) for g in item.get("globs", []))
    return paths


def _stat_item(item) -> Tuple[int, int]:
    size, count = _stat_dirs(_dir_paths(item))
    s2, c2 = _stat_globs(item.get("globs", []), item.get("exclude_globs", []))
    return size + s2, count + c2


def _clear_item(item) -> Tuple[int, int]:
    freed, removed = 0, 0
    for d in _dir_paths(item):
        f, r = _clear_dir_contents(d)
        freed += f
        removed += r
    f2, r2 = _clear_globs(item.get("globs", []), item.get("exclude_globs", []))
    return freed + f2, removed + r2


@router.get("/artifacts")
def list_artifacts():
    items = []
    for item in ARTIFACT_REGISTRY:
        size_bytes, file_count = _stat_item(item)
        items.append({
            "key": item["key"],
            "name": item["name"],
            "description": item["description"],
            "paths": _display_paths(item),
            "file_count": file_count,
            "size_bytes": size_bytes,
            "deletable": item["deletable"],
            "warning": item["warning"],
        })
    return R.success(data={"artifacts": items})


class CleanupRequest(BaseModel):
    keys: List[str]


@router.post("/artifacts/cleanup")
def cleanup_artifacts(data: CleanupRequest):
    results = []
    known_keys = set(_KEY_TO_META.keys())
    unknown = [k for k in data.keys if k not in known_keys]
    if unknown:
        return R.error(msg=f"未知的生成物类型: {', '.join(unknown)}", code=400)

    for key in data.keys:
        meta = _KEY_TO_META[key]
        if not meta["deletable"]:
            results.append({"key": key, "status": "refused", "msg": "该生成物不允许批量清理"})
            continue
        freed, removed = _clear_item(meta)
        logger.info(f"[artifacts] 清理 {key}: 删除 {removed} 个文件，释放 {freed} 字节")
        results.append({
            "key": key,
            "status": "done",
            "removed_files": removed,
            "freed_bytes": freed,
            "msg": f"已删除 {removed} 个文件，释放 {freed / 1024 / 1024:.2f} MB",
        })
    return R.success(data={"results": results})