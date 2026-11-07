import pathlib
import sys
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.db import video_task_dao
from app.db.engine import Base
from app.db.models.video_tasks import VideoTask


class TestBatchTaskOrder(unittest.TestCase):
    """项目内笔记列表按创建时间从近到远（/batch_status 直接透传该顺序）。"""

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

    def _insert(self, task_id: str, batch_id: str, created_at: str) -> None:
        db = self.Session()
        try:
            db.add(VideoTask(
                video_id=f'video-{task_id}',
                platform='bilibili',
                task_id=task_id,
                batch_id=batch_id,
                created_at=datetime.strptime(created_at, '%Y-%m-%d %H:%M:%S'),
            ))
            db.commit()
        finally:
            db.close()

    def test_list_tasks_by_batch_returns_newest_first(self):
        self._insert('task-old', 'batch-1', '2026-01-01 10:00:00')
        self._insert('task-new', 'batch-1', '2026-01-03 10:00:00')
        self._insert('task-mid', 'batch-1', '2026-01-02 10:00:00')
        self._insert('task-other-batch', 'batch-2', '2026-01-09 10:00:00')

        rows = video_task_dao.list_tasks_by_batch('batch-1')

        self.assertEqual([row.task_id for row in rows], ['task-new', 'task-mid', 'task-old'])

    def test_same_second_tasks_fall_back_to_latest_insert_first(self):
        # SQLite CURRENT_TIMESTAMP 只有秒级精度：批量提交常落在同一秒内，
        # 此时用自增 id 兜底，后插入（提交更晚）的排在最前。
        self._insert('task-first', 'batch-1', '2026-01-01 10:00:00')
        self._insert('task-second', 'batch-1', '2026-01-01 10:00:00')
        self._insert('task-third', 'batch-1', '2026-01-01 10:00:00')

        rows = video_task_dao.list_tasks_by_batch('batch-1')

        self.assertEqual([row.task_id for row in rows], ['task-third', 'task-second', 'task-first'])

    def test_empty_batch_returns_empty_list(self):
        self.assertEqual(video_task_dao.list_tasks_by_batch('missing-batch'), [])


if __name__ == '__main__':
    unittest.main()
