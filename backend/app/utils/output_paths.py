import os
import re
from pathlib import Path
from typing import Optional

NOTE_OUTPUT_DIR = Path(os.getenv('NOTE_OUTPUT_DIR', 'backend/note_results'))
JSON_OUTPUT_DIR = Path(os.getenv('JSON_OUTPUT_DIR', 'backend/json_results'))

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
