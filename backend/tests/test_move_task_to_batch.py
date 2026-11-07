import pathlib
import sys
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.db import video_task_dao
from app.db.engine import Base
from app.db.models.video_tasks import VideoTask
from app.routers import note


class TestMoveTaskToBatchEndpoint(unittest.TestCase):
    """合约：空 batch_id + 空 batch_name 表示「移出项目」，不能当成参数错误拒绝。"""

    def setUp(self):
        app = FastAPI()
        app.include_router(note.router, prefix='/api')
        self.client = TestClient(app)

    @patch('app.routers.note.move_task_to_batch')
    def test_empty_batch_values_detach_task(self, mock_move):
        mock_move.return_value = True

        response = self.client.post('/api/move_task_to_batch', json={
            'task_id': 'task-1',
            'batch_id': '',
            'batch_name': '',
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['code'], 0)
        mock_move.assert_called_once_with('task-1', None, None)

    @patch('app.routers.note.move_task_to_batch')
    def test_missing_batch_keys_are_treated_as_detach(self, mock_move):
        mock_move.return_value = True

        response = self.client.post('/api/move_task_to_batch', json={'task_id': 'task-1'})

        self.assertEqual(response.json()['code'], 0)
        mock_move.assert_called_once_with('task-1', None, None)

    @patch('app.routers.note.move_task_to_batch')
    def test_only_one_batch_value_is_rejected(self, mock_move):
        # 只有 batch_id 没有名字（或反之）会留下半状态批次，属于真正的参数错误。
        response = self.client.post('/api/move_task_to_batch', json={
            'task_id': 'task-1',
            'batch_id': 'batch-1',
            'batch_name': '',
        })

        self.assertEqual(response.json()['code'], 400)
        mock_move.assert_not_called()

    @patch('app.routers.note.move_task_to_batch')
    def test_move_into_batch_passes_values_through(self, mock_move):
        mock_move.return_value = True

        response = self.client.post('/api/move_task_to_batch', json={
            'task_id': 'task-1',
            'batch_id': 'batch-1',
            'batch_name': 'Batch One',
        })

        self.assertEqual(response.json()['code'], 0)
        mock_move.assert_called_once_with('task-1', 'batch-1', 'Batch One')

    def test_missing_task_returns_404(self):
        with patch('app.routers.note.move_task_to_batch', return_value=False):
            response = self.client.post('/api/move_task_to_batch', json={
                'task_id': 'nope',
                'batch_id': '',
                'batch_name': '',
            })

        self.assertEqual(response.json()['code'], 404)

    def test_empty_task_id_returns_400(self):
        response = self.client.post('/api/move_task_to_batch', json={'task_id': '', 'batch_id': '', 'batch_name': ''})
        self.assertEqual(response.json()['code'], 400)


class TestMoveTaskToBatchDao(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix='.db')
        self.engine = create_engine(
            f'sqlite:///{self.tmp.name}',
            connect_args={'check_same_thread': False},
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        def fake_get_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self._patcher = patch.object(video_task_dao, 'get_db', fake_get_db)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self.engine.dispose()
        self.tmp.close()

    def _insert(self, task_id: str, batch_id: str, batch_name: str) -> None:
        db = self.Session()
        try:
            db.add(VideoTask(
                video_id=f'video-{task_id}',
                platform='bilibili',
                task_id=task_id,
                batch_id=batch_id,
                batch_name=batch_name,
                created_at=datetime(2026, 1, 1, 10, 0, 0),
            ))
            db.commit()
        finally:
            db.close()

    def _row(self, task_id: str) -> VideoTask:
        db = self.Session()
        try:
            return db.query(VideoTask).filter_by(task_id=task_id).first()
        finally:
            db.close()

    def test_move_assigns_batch(self):
        self._insert('task-1', None, None)

        self.assertTrue(video_task_dao.move_task_to_batch('task-1', 'batch-1', 'Batch One'))

        row = self._row('task-1')
        self.assertEqual(row.batch_id, 'batch-1')
        self.assertEqual(row.batch_name, 'Batch One')

    def test_empty_values_detach_to_null(self):
        self._insert('task-1', 'batch-1', 'Batch One')

        # 空字符串也必须归一化成 NULL：路由已把空值转成 None，DAO 这层再兜一次，
        # 防止其它调用方直接传 ''（/all_batches 用 isnot(None) 过滤，空字符串批次
        # 会被列成一个没有名字的幽灵项目）。
        self.assertTrue(video_task_dao.move_task_to_batch('task-1', '', ''))

        row = self._row('task-1')
        self.assertIsNone(row.batch_id)
        self.assertIsNone(row.batch_name)

    def test_none_values_detach_to_null(self):
        self._insert('task-1', 'batch-1', 'Batch One')

        self.assertTrue(video_task_dao.move_task_to_batch('task-1', None, None))

        row = self._row('task-1')
        self.assertIsNone(row.batch_id)
        self.assertIsNone(row.batch_name)

    def test_detached_batch_disappears_from_all_batches(self):
        self._insert('task-1', 'batch-1', 'Batch One')

        video_task_dao.move_task_to_batch('task-1', None, None)

        self.assertEqual(video_task_dao.get_all_batches(), [])

    def test_missing_task_returns_false(self):
        self.assertFalse(video_task_dao.move_task_to_batch('nope', 'batch-1', 'Batch One'))


if __name__ == '__main__':
    unittest.main()
