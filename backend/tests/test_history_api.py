import pathlib
import sys
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.routers import note


class _Row:
    def __init__(self, task_id: str, created_at: str):
        self.task_id = task_id
        self.created_at = created_at


class TestHistoryApi(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(note.router, prefix='/api')
        self.client = TestClient(app)

    def test_history_offset_applies_after_filtering(self):
        rows = [
            _Row('task-failed-1', '2026-08-25T10:00:00'),
            _Row('task-success-1', '2026-08-25T09:00:00'),
            _Row('task-failed-2', '2026-08-25T08:00:00'),
            _Row('task-success-2', '2026-08-25T07:00:00'),
            _Row('task-success-3', '2026-08-25T06:00:00'),
        ]

        def fake_list_recent_tasks(limit=100, offset=0):
            return rows[offset: offset + limit]

        def fake_build_task_item(task_id, *, row=None):
            success = task_id.startswith('task-success')
            return {
                'task_id': task_id,
                'created_at': row.created_at,
                'status': 'SUCCESS' if success else 'FAILED',
                'result': {'ok': True} if success else None,
            }

        with patch('app.routers.note.list_recent_tasks', side_effect=fake_list_recent_tasks), patch(
            'app.routers.note._build_task_item', side_effect=fake_build_task_item
        ):
            response = self.client.get('/api/history?limit=2&offset=1')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual([item['task_id'] for item in data], ['task-success-2', 'task-success-3'])

    def test_history_returns_requested_page_when_early_rows_are_filtered(self):
        rows = [
            _Row('task-failed-1', '2026-08-25T10:00:00'),
            _Row('task-failed-2', '2026-08-25T09:00:00'),
            _Row('task-success-1', '2026-08-25T08:00:00'),
            _Row('task-success-2', '2026-08-25T07:00:00'),
            _Row('task-success-3', '2026-08-25T06:00:00'),
        ]

        def fake_list_recent_tasks(limit=100, offset=0):
            return rows[offset: offset + limit]

        def fake_build_task_item(task_id, *, row=None):
            success = task_id.startswith('task-success')
            return {
                'task_id': task_id,
                'created_at': row.created_at,
                'status': 'SUCCESS' if success else 'FAILED',
                'result': {'ok': True} if success else None,
            }

        with patch('app.routers.note.list_recent_tasks', side_effect=fake_list_recent_tasks), patch(
            'app.routers.note._build_task_item', side_effect=fake_build_task_item
        ):
            response = self.client.get('/api/history?limit=2&offset=0')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual([item['task_id'] for item in data], ['task-success-1', 'task-success-2'])


if __name__ == '__main__':
    unittest.main()
