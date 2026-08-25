import json
import shutil
import sqlite3
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

ROOT_DB = Path('bili_note.db')
BACKUP_DB = Path('bili_note.db.backup-before-douyin-url-normalize')

DOUYIN_CANONICAL_BASE = 'https://www.douyin.com/video/'


def extract_douyin_video_id(text: str) -> Optional[str]:
    normalized = str(text or '').strip()
    if not normalized:
        return None

    parsed = urlparse(normalized)
    path_parts = [part for part in (parsed.path or '').split('/') if part]
    if 'video' in path_parts:
        idx = path_parts.index('video')
        if idx + 1 < len(path_parts) and path_parts[idx + 1].isdigit():
            return path_parts[idx + 1]

    aweme_id = parse_qs(parsed.query).get('aweme_id', [None])[0]
    if aweme_id and aweme_id.isdigit():
        return aweme_id

    modal_id = parse_qs(parsed.query).get('modal_id', [None])[0]
    if modal_id and modal_id.isdigit():
        return modal_id

    return None


def canonical_douyin_url(video_id: Optional[str]) -> Optional[str]:
    if not video_id:
        return None
    return f'{DOUYIN_CANONICAL_BASE}{video_id}'


def normalize_request_payload(raw_payload: Optional[str], canonical_url: str) -> tuple[Optional[str], bool]:
    if not raw_payload:
        return raw_payload, False

    try:
        payload = json.loads(raw_payload)
    except Exception:
        return raw_payload, False

    if not isinstance(payload, dict):
        return raw_payload, False

    if payload.get('video_url') == canonical_url:
        return raw_payload, False

    payload['video_url'] = canonical_url
    return json.dumps(payload, ensure_ascii=False), True


def should_normalize(source_url: Optional[str], request_payload: Optional[str], canonical_url: str) -> bool:
    if source_url != canonical_url:
        return True
    if not request_payload:
        return False
    try:
        payload = json.loads(request_payload)
    except Exception:
        return False
    return isinstance(payload, dict) and payload.get('video_url') != canonical_url


def main() -> None:
    if not ROOT_DB.exists():
        raise SystemExit(f'missing db: {ROOT_DB}')
    if BACKUP_DB.exists():
        raise SystemExit(f'backup already exists: {BACKUP_DB}')

    shutil.copy2(ROOT_DB, BACKUP_DB)
    print(f'backup_created={BACKUP_DB}')

    conn = sqlite3.connect(ROOT_DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            'SELECT id, task_id, video_id, source_url, request_payload FROM video_tasks WHERE platform = ?',
            ('douyin',),
        ).fetchall()

        updated = []
        skipped = 0
        for row in rows:
            video_id = row['video_id'] or extract_douyin_video_id(row['source_url'] or '')
            canonical_url = canonical_douyin_url(video_id)
            if not canonical_url:
                skipped += 1
                continue

            if not should_normalize(row['source_url'], row['request_payload'], canonical_url):
                skipped += 1
                continue

            normalized_payload, payload_changed = normalize_request_payload(row['request_payload'], canonical_url)
            conn.execute(
                'UPDATE video_tasks SET source_url = ?, request_payload = ? WHERE id = ?',
                (
                    canonical_url,
                    normalized_payload if payload_changed else row['request_payload'],
                    row['id'],
                ),
            )
            updated.append(
                {
                    'task_id': row['task_id'],
                    'video_id': video_id,
                    'source_url': row['source_url'],
                    'canonical_url': canonical_url,
                    'request_payload_updated': payload_changed,
                }
            )

        conn.commit()
        print(f'updated={len(updated)}')
        print(f'skipped={skipped}')
        print('sample=')
        for item in updated[:20]:
            print(item)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
