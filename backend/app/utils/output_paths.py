import os
import re
from pathlib import Path
from typing import Optional

from app.utils.path_helper import APP_ROOT


def _resolve_output_dir(env_name: str, default_relative: str) -> Path:
    """把输出目录锚定到后端目录（main.py 所在目录），与启动 CWD 无关。

    兼容历史 env 写法：.env 里的 'backend/note_results' 是「仓库根视角」，
    这里剥掉 backend/ 前缀后按 APP_ROOT 解析，本地与 Docker 行为一致：
      - 本地源码运行：BiliNote/backend/<name>
      - Docker（./backend:/app）：/app/<name>（随挂载卷持久化）
    """
    raw = os.getenv(env_name)
    relative = (raw or default_relative).strip()
    while relative.startswith("./"):
        relative = relative[2:]
    if relative.startswith("backend/"):
        relative = relative[len("backend/"):]
    return (Path(APP_ROOT) / relative).resolve()


NOTE_OUTPUT_DIR = _resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')
JSON_OUTPUT_DIR = _resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')

NOTE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
JSON_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_note_title(title: Optional[str], fallback: str) -> str:
    raw = (title or '').strip()
    if not raw:
        return fallback
    sanitized = re.sub(r'[\\/:*?"<>|]+', '_', raw)
    sanitized = re.sub(r'\s+', ' ', sanitized).strip(' ._')
    return sanitized[:120] or fallback


def note_markdown_path(task_id: str, title: Optional[str] = None) -> Path:
    if title and title.strip():
        return NOTE_OUTPUT_DIR / f'{sanitize_note_title(title, task_id)}.md'
    return NOTE_OUTPUT_DIR / f'{task_id}_markdown.md'


def note_json_path(task_id: str) -> Path:
    return JSON_OUTPUT_DIR / f'{task_id}.json'


def audio_json_path(task_id: str) -> Path:
    return JSON_OUTPUT_DIR / f'{task_id}_audio.json'


def transcript_json_path(task_id: str) -> Path:
    return JSON_OUTPUT_DIR / f'{task_id}_transcript.json'


def task_status_path(task_id: str) -> Path:
    return JSON_OUTPUT_DIR / f'{task_id}.status.json'


def markdown_status_path(task_id: str) -> Path:
    return JSON_OUTPUT_DIR / f'{task_id}_markdown.status.json'


def checkpoint_json_path(key: str) -> Path:
    return JSON_OUTPUT_DIR / f'{key}.gpt.checkpoint.json'
