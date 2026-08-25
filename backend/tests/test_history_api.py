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


def _make_fake_build():
    def fake_build_task_item(task_id, *, row=None):
        success = task_id.startswith('task-success')
        return {
            'task_id': task_id,
            'created_at': row.created_at,
            'status': 'SUCCESS' if success else 'FAILED',
            'result': {'ok': True} if success else None,
        }
    return fake_build_task_item


class TestHistoryApi(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(note.router, prefix='/api')
        self.client = TestClient(app)

    def test_history_keeps_failed_tasks(self):
        """Failed tasks must stay in the history so the frontend can render
        a failed card with a retry action instead of silently dropping them."""
        rows = [
            _Row('task-failed-1', '2026-08-25T10:00:00'),
            _Row('task-success-1', '2026-08-25T09:00:00'),
            _Row('task-failed-2', '2026-08-25T08:00:00'),
        ]

        def fake_list_recent_tasks(limit=100, offset=0):
            return rows[offset: offset + limit]

        with patch('app.routers.note.list_recent_tasks', side_effect=fake_list_recent_tasks), patch(
            'app.routers.note._build_task_item', side_effect=_make_fake_build()
        ):
            response = self.client.get('/api/history?limit=10')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(
            [item['task_id'] for item in data],
            ['task-failed-1', 'task-failed-2', 'task-success-1'],
        )

    def test_history_offset_applies_after_filtering_when_pending_excluded(self):
        rows = [
            _Row('task-pending-1', '2026-08-25T10:00:00'),
            _Row('task-success-1', '2026-08-25T09:00:00'),
            _Row('task-pending-2', '2026-08-25T08:00:00'),
            _Row('task-success-2', '2026-08-25T07:00:00'),
            _Row('task-success-3', '2026-08-25T06:00:00'),
        ]

        def fake_list_recent_tasks(limit=100, offset=0):
            return rows[offset: offset + limit]

        def fake_build_task_item(task_id, *, row=None):
            item = _make_fake_build()(task_id, row=row)
            if task_id.startswith('task-pending'):
                item['status'] = 'TRANSCRIBING'
                item['result'] = None
            return item

        with patch('app.routers.note.list_recent_tasks', side_effect=fake_list_recent_tasks), patch(
            'app.routers.note._build_task_item', side_effect=fake_build_task_item
        ):
            response = self.client.get('/api/history?limit=2&offset=1&include_pending=false')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual([item['task_id'] for item in data], ['task-success-2', 'task-success-3'])

    def test_history_returns_requested_page_when_early_rows_are_filtered(self):
        rows = [
            _Row('task-pending-1', '2026-08-25T10:00:00'),
            _Row('task-pending-2', '2026-08-25T09:00:00'),
            _Row('task-success-1', '2026-08-25T08:00:00'),
            _Row('task-success-2', '2026-08-25T07:00:00'),
            _Row('task-success-3', '2026-08-25T06:00:00'),
        ]

        def fake_list_recent_tasks(limit=100, offset=0):
            return rows[offset: offset + limit]

        def fake_build_task_item(task_id, *, row=None):
            item = _make_fake_build()(task_id, row=row)
            if task_id.startswith('task-pending'):
                item['status'] = 'TRANSCRIBING'
                item['result'] = None
            return item

        with patch('app.routers.note.list_recent_tasks', side_effect=fake_list_recent_tasks), patch(
            'app.routers.note._build_task_item', side_effect=fake_build_task_item
        ):
            response = self.client.get('/api/history?limit=2&offset=0&include_pending=false')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual([item['task_id'] for item in data], ['task-success-1', 'task-success-2'])


if __name__ == '__main__':
    unittest.main()
