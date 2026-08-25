import argparse
import shutil
import sqlite3
from pathlib import Path

ROOT_DB = Path('bili_note.db')
LEGACY_DB = Path('backend/bili_note.db')
BACKUP_DB = Path('bili_note.db.backup-before-legacy-merge')


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()]


def fetch_rows(conn: sqlite3.Connection, table: str, cols: list[str]) -> list[dict]:
    query = f"SELECT {', '.join(cols)} FROM {table}"
    result = []
    for row in conn.execute(query).fetchall():
        result.append(dict(zip(cols, row)))
    return result


def ensure_backup() -> None:
    if BACKUP_DB.exists():
        return
    shutil.copy2(ROOT_DB, BACKUP_DB)


def merge_providers(root: sqlite3.Connection, legacy: sqlite3.Connection, *, custom_only: bool) -> dict:
    cols = ['id', 'name', 'logo', 'type', 'api_key', 'base_url', 'enabled']
    root_rows = {row['id']: row for row in fetch_rows(root, 'providers', cols)}
    legacy_rows = fetch_rows(legacy, 'providers', cols)
    inserted = 0
    skipped = 0

    for row in legacy_rows:
        if custom_only and row['type'] != 'custom':
            skipped += 1
            continue

        existing = root_rows.get(row['id'])
        if existing:
            skipped += 1
            continue

        same_endpoint = next(
            (
                item for item in root_rows.values()
                if item['type'] == row['type']
                and item['name'] == row['name']
                and item['base_url'] == row['base_url']
            ),
            None,
        )
        if same_endpoint:
            skipped += 1
            continue

        root.execute(
            'INSERT INTO providers (id, name, logo, type, api_key, base_url, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (
                row['id'],
                row['name'],
                row['logo'],
                row['type'],
                row['api_key'],
                row['base_url'],
                row['enabled'],
            ),
        )
        root_rows[row['id']] = row
        inserted += 1

    return {'inserted': inserted, 'skipped': skipped}


def merge_models(root: sqlite3.Connection, legacy: sqlite3.Connection, *, custom_only: bool) -> dict:
    root_rows = {
        (str(row['provider_id']), row['model_name'])
        for row in fetch_rows(root, 'models', ['provider_id', 'model_name'])
    }
    legacy_rows = fetch_rows(legacy, 'models', ['provider_id', 'model_name'])
    inserted = 0
    skipped = 0

    root_provider_rows = fetch_rows(root, 'providers', ['id', 'type'])
    root_provider_ids = {str(row['id']) for row in root_provider_rows}
    root_custom_provider_ids = {str(row['id']) for row in root_provider_rows if row['type'] == 'custom'}

    legacy_provider_types = {
        str(row['id']): row['type'] for row in fetch_rows(legacy, 'providers', ['id', 'type'])
    }

    for row in legacy_rows:
        provider_id = str(row['provider_id'])
        key = (provider_id, row['model_name'])
        if key in root_rows:
            skipped += 1
            continue
        if provider_id not in root_provider_ids:
            skipped += 1
            continue
        if custom_only and legacy_provider_types.get(provider_id) != 'custom':
            skipped += 1
            continue
        if custom_only and provider_id not in root_custom_provider_ids:
            skipped += 1
            continue
        root.execute(
            'INSERT INTO models (provider_id, model_name) VALUES (?, ?)',
            (row['provider_id'], row['model_name']),
        )
        root_rows.add(key)
        inserted += 1

    return {'inserted': inserted, 'skipped': skipped}


def merge_video_tasks(root: sqlite3.Connection, legacy: sqlite3.Connection, *, include_tasks: bool) -> dict:
    if not include_tasks:
        return {'inserted': 0, 'skipped': 0}

    legacy_cols = columns(legacy, 'video_tasks')
    root_cols = columns(root, 'video_tasks')
    selected_cols = [col for col in ['video_id', 'platform', 'task_id', 'batch_id', 'source_url', 'title', 'batch_name', 'request_payload'] if col in legacy_cols]
    rows = fetch_rows(legacy, 'video_tasks', selected_cols)
    root_task_ids = {row['task_id'] for row in fetch_rows(root, 'video_tasks', ['task_id'])}
    inserted = 0
    skipped = 0

    for row in rows:
        if row['task_id'] in root_task_ids:
            skipped += 1
            continue

        payload = {
            'video_id': row.get('video_id', ''),
            'platform': row.get('platform', ''),
            'task_id': row['task_id'],
            'batch_id': row.get('batch_id'),
            'source_url': row.get('source_url'),
            'title': row.get('title'),
            'batch_name': row.get('batch_name') if 'batch_name' in root_cols else None,
            'request_payload': row.get('request_payload') if 'request_payload' in root_cols else None,
        }
        root.execute(
            'INSERT INTO video_tasks (video_id, platform, task_id, batch_id, source_url, title, batch_name, request_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (
                payload['video_id'],
                payload['platform'],
                payload['task_id'],
                payload['batch_id'],
                payload['source_url'],
                payload['title'],
                payload['batch_name'],
                payload['request_payload'],
            ),
        )
        root_task_ids.add(row['task_id'])
        inserted += 1

    return {'inserted': inserted, 'skipped': skipped}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Merge legacy backend/bili_note.db into root bili_note.db')
    parser.add_argument(
        '--custom-only',
        action='store_true',
        help='only merge custom providers and their models',
    )
    parser.add_argument(
        '--skip-tasks',
        action='store_true',
        help='skip merging legacy video_tasks rows',
    )
    return parser.parse_args()



def main() -> None:
    args = parse_args()
    if not ROOT_DB.exists():
        raise SystemExit(f'missing root db: {ROOT_DB}')
    if not LEGACY_DB.exists():
        raise SystemExit(f'missing legacy db: {LEGACY_DB}')

    ensure_backup()

    root = sqlite3.connect(ROOT_DB)
    legacy = sqlite3.connect(LEGACY_DB)
    try:
        for table in ['providers', 'models', 'video_tasks']:
            if not table_exists(root, table):
                raise SystemExit(f'root db missing table: {table}')
            if not table_exists(legacy, table):
                raise SystemExit(f'legacy db missing table: {table}')

        provider_stats = merge_providers(root, legacy, custom_only=args.custom_only)
        model_stats = merge_models(root, legacy, custom_only=args.custom_only)
        task_stats = merge_video_tasks(root, legacy, include_tasks=not args.skip_tasks)
        root.commit()

        print('merge complete')
        print('backup=', BACKUP_DB)
        print('custom_only=', args.custom_only)
        print('skip_tasks=', args.skip_tasks)
        print('providers=', provider_stats)
        print('models=', model_stats)
        print('video_tasks=', task_stats)
    finally:
        root.close()
        legacy.close()


if __name__ == '__main__':
    main()
