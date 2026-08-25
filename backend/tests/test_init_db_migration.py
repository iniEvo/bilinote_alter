import importlib
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.db.init_db import _ensure_video_tasks_columns


class TestInitDbMigration(unittest.TestCase):
    def test_prefers_workspace_db_by_default(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = pathlib.Path(tmpdir)
            backend_dir = workspace / 'backend'
            app_db_dir = backend_dir / 'app' / 'db'
            app_db_dir.mkdir(parents=True)
            root_db = workspace / 'bili_note.db'
            backend_db = backend_dir / 'bili_note.db'
            module_file = app_db_dir / 'engine.py'
            module_file.write_text('# stub', encoding='utf-8')

            with patch('pathlib.Path.resolve', return_value=module_file):
                engine_module = importlib.import_module('app.db.engine')
                importlib.reload(engine_module)
                root_db.touch()
                backend_db.touch()
                self.assertEqual(engine_module._default_database_url(), f'sqlite:///{root_db}')
                root_db.unlink()
                self.assertEqual(engine_module._default_database_url(), f'sqlite:///{backend_db}')

    def test_adds_missing_batch_columns(self):
        with tempfile.NamedTemporaryFile(suffix='.db') as tmp:
            conn = sqlite3.connect(tmp.name)
            conn.execute(
                'CREATE TABLE video_tasks ('
                'id INTEGER PRIMARY KEY AUTOINCREMENT, '
                'video_id VARCHAR NOT NULL, '
                'platform VARCHAR NOT NULL, '
                'task_id VARCHAR NOT NULL UNIQUE, '
                'created_at DATETIME'
                ')'
            )
            conn.commit()
            conn.close()

            engine = create_engine(f'sqlite:///{tmp.name}', connect_args={'check_same_thread': False})
            _ensure_video_tasks_columns(engine)

            conn = sqlite3.connect(tmp.name)
            columns = {row[1] for row in conn.execute('PRAGMA table_info(video_tasks)')}
            indexes = {row[1] for row in conn.execute('PRAGMA index_list(video_tasks)')}
            conn.close()

            self.assertIn('batch_id', columns)
            self.assertIn('source_url', columns)
            self.assertIn('title', columns)
            self.assertIn('batch_name', columns)
            self.assertIn('request_payload', columns)
            self.assertIn('ix_video_tasks_batch_id', indexes)


if __name__ == '__main__':
    unittest.main()
