import sqlite3
from pathlib import Path

ROOT_DB = Path('bili_note.db')
LEGACY_DB = Path('backend/bili_note.db')


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def scalar_set(conn: sqlite3.Connection, sql: str) -> set:
    return {row[0] for row in conn.execute(sql).fetchall()}


def main() -> None:
    if not ROOT_DB.exists():
        raise SystemExit(f'missing root db: {ROOT_DB}')
    if not LEGACY_DB.exists():
        raise SystemExit(f'missing legacy db: {LEGACY_DB}')

    root = sqlite3.connect(ROOT_DB)
    legacy = sqlite3.connect(LEGACY_DB)
    try:
        for table in ['providers', 'models', 'video_tasks']:
            if not table_exists(root, table):
                raise SystemExit(f'root db missing table: {table}')
            if not table_exists(legacy, table):
                raise SystemExit(f'legacy db missing table: {table}')

        root_tasks = scalar_set(root, 'SELECT task_id FROM video_tasks')
        legacy_tasks = scalar_set(legacy, 'SELECT task_id FROM video_tasks')
        root_providers = scalar_set(root, 'SELECT id FROM providers')
        legacy_providers = scalar_set(legacy, 'SELECT id FROM providers')
        root_models = scalar_set(root, "SELECT provider_id || '::' || model_name FROM models")
        legacy_models = scalar_set(legacy, "SELECT provider_id || '::' || model_name FROM models")

        print('merge verification')
        print('root_db=', ROOT_DB)
        print('legacy_db=', LEGACY_DB)
        print('tasks_only_in_legacy=', len(legacy_tasks - root_tasks))
        print('providers_only_in_legacy=', len(legacy_providers - root_providers))
        print('models_only_in_legacy=', len(legacy_models - root_models))
        print('legacy_only_task_samples=', sorted(list(legacy_tasks - root_tasks))[:10])
        print('legacy_only_provider_samples=', sorted(list(legacy_providers - root_providers))[:10])
        print('legacy_only_model_samples=', sorted(list(legacy_models - root_models))[:10])
    finally:
        root.close()
        legacy.close()


if __name__ == '__main__':
    main()
