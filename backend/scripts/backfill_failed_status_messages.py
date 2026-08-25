import json
import shutil
import sqlite3
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

ROOT_DB = Path('bili_note.db')
STATUS_DIR = Path('backend/json_results')
BACKUP_DIR = STATUS_DIR / '.status-backups-before-failed-message-backfill'


def infer_message(platform: Optional[str], video_id: Optional[str], source_url: Optional[str]) -> str:
    if platform == 'douyin':
        target = video_id or extract_douyin_video_id(source_url or '') or '该视频'
        return (
            f'抖音视频 {target} 可能已删除、不可访问，或详情接口未返回有效视频信息。'
            '请检查链接是否仍可打开，或稍后重试。'
        )
    return '任务失败，未写入详细原因'


def extract_douyin_video_id(url: str) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    parts = [part for part in (parsed.path or '').split('/') if part]
    if 'video' in parts:
        idx = parts.index('video')
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return None


def ensure_backup_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
    if not ROOT_DB.exists():
        raise SystemExit(f'missing db: {ROOT_DB}')
    if not STATUS_DIR.exists():
        raise SystemExit(f'missing status dir: {STATUS_DIR}')

    conn = sqlite3.connect(ROOT_DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute('SELECT task_id, platform, video_id, source_url FROM video_tasks').fetchall()
        updated = []
        skipped = 0
        ensure_backup_dir()

        for row in rows:
            status_path = STATUS_DIR / f"{row['task_id']}.status.json"
            if not status_path.exists():
                skipped += 1
                continue

            try:
                data = json.loads(status_path.read_text(encoding='utf-8'))
            except Exception:
                skipped += 1
                continue

            if data.get('status') != 'FAILED':
                skipped += 1
                continue

            if str(data.get('message') or '').strip():
                skipped += 1
                continue

            message = infer_message(row['platform'], row['video_id'], row['source_url'])
            backup_path = BACKUP_DIR / status_path.name
            if not backup_path.exists():
                shutil.copy2(status_path, backup_path)

            data['message'] = message
            status_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            updated.append((row['task_id'], row['platform'], row['video_id'], message))

        print('updated=', len(updated))
        print('skipped=', skipped)
        print('backup_dir=', BACKUP_DIR)
        print('sample=')
        for item in updated[:10]:
            print({
                'task_id': item[0],
                'platform': item[1],
                'video_id': item[2],
                'message': item[3],
            })
    finally:
        conn.close()


if __name__ == '__main__':
    main()
