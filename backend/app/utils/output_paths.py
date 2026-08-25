import os
import re
from pathlib import Path
from typing import Optional

_WORKSPACE_ROOT = Path(__file__).resolve().parents[3]


def _resolve_output_dir(env_name: str, default_relative: str) -> Path:
    raw = os.getenv(env_name)
    if raw:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (_WORKSPACE_ROOT / path).resolve()
        return path
    return (_WORKSPACE_ROOT / default_relative).resolve()


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
