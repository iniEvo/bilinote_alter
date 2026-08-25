import argparse
import shutil
import sqlite3
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

LEGACY_DB = Path('backend/bili_note.db')
BACKUP_DB = Path('backend/bili_note.db.backup-before-task-fix')


def infer_platform(url: str) -> Optional[str]:
    if not url:
        return None
    host = urlparse(url).netloc.lower()
    if 'douyin.com' in host:
        return 'douyin'
    if 'bilibili.com' in host or host == 'b23.tv':
        return 'bilibili'
    if 'youtube.com' in host or 'youtu.be' in host:
        return 'youtube'
    return None


def extract_video_id(platform: str, url: str) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    path = parsed.path or ''
    parts = [part for part in path.split('/') if part]
    if platform == 'douyin':
        if 'video' in parts:
            idx = parts.index('video')
            if idx + 1 < len(parts):
                return parts[idx + 1]
    if platform == 'bilibili':
        for part in parts:
            if part.startswith('BV') or part.startswith('av'):
                return part
    if platform == 'youtube':
        if parsed.netloc.endswith('youtu.be') and parts:
            return parts[0]
        if parsed.query:
            for chunk in parsed.query.split('&'):
                if chunk.startswith('v='):
                    return chunk[2:]
    return None


def ensure_backup() -> None:
    if BACKUP_DB.exists():
        return
    shutil.copy2(LEGACY_DB, BACKUP_DB)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Fix obvious legacy task metadata errors in backend/bili_note.db')
    parser.add_argument('--dry-run', action='store_true', help='preview fixes without writing changes')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not LEGACY_DB.exists():
        raise SystemExit(f'missing legacy db: {LEGACY_DB}')

    ensure_backup()
    conn = sqlite3.connect(LEGACY_DB)
    try:
        rows = conn.execute(
            'SELECT task_id, video_id, platform, source_url FROM video_tasks ORDER BY created_at DESC'
        ).fetchall()

        updates = []
        skipped = 0
        for task_id, video_id, platform, source_url in rows:
            candidate_url = source_url or video_id
            inferred_platform = infer_platform(candidate_url)
            if not inferred_platform:
                skipped += 1
                continue
            inferred_video_id = extract_video_id(inferred_platform, candidate_url)
            if not inferred_video_id:
                skipped += 1
                continue

            new_platform = inferred_platform if platform != inferred_platform else platform
            new_video_id = inferred_video_id if video_id != inferred_video_id else video_id
            new_source_url = candidate_url if not source_url and candidate_url.startswith('http') else source_url

            if new_platform == platform and new_video_id == video_id and new_source_url == source_url:
                skipped += 1
                continue

            updates.append((new_video_id, new_platform, new_source_url, task_id, video_id, platform, source_url))

        print('dry_run=', args.dry_run)
        print('backup=', BACKUP_DB)
        print('rows_to_fix=', len(updates))
        print('rows_skipped=', skipped)
        print('sample_changes=')
        for row in updates[:10]:
            new_video_id, new_platform, new_source_url, task_id, old_video_id, old_platform, old_source_url = row
            print({
                'task_id': task_id,
                'old_video_id': old_video_id,
                'new_video_id': new_video_id,
                'old_platform': old_platform,
                'new_platform': new_platform,
                'old_source_url': old_source_url,
                'new_source_url': new_source_url,
            })

        if args.dry_run:
            return

        for new_video_id, new_platform, new_source_url, task_id, *_ in updates:
            conn.execute(
                'UPDATE video_tasks SET video_id = ?, platform = ?, source_url = ? WHERE task_id = ?',
                (new_video_id, new_platform, new_source_url, task_id),
            )
        conn.commit()
        print('updated_rows=', len(updates))
    finally:
        conn.close()


if __name__ == '__main__':
    main()
