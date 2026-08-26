import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.batch_control_store import BatchControlStore


class TestBatchControlStore(unittest.TestCase):
    def test_paused_and_canceled_persist_across_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'batch_controls.json'
            store = BatchControlStore(filepath=str(path))
            store.set('b1', 'PAUSED')
            store.set('b2', 'CANCELED')

            # 模拟后端重启：新实例从同一文件恢复
            restarted = BatchControlStore(filepath=str(path))
            self.assertEqual(restarted.get('b1'), 'PAUSED')
            self.assertEqual(restarted.get('b2'), 'CANCELED')

    def test_running_is_default_and_not_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'batch_controls.json'
            store = BatchControlStore(filepath=str(path))
            store.set('b1', 'PAUSED')

            # 恢复为默认态（RUNNING = 删除持久化标记）
            store.set('b1', 'RUNNING')

            restarted = BatchControlStore(filepath=str(path))
            self.assertIsNone(restarted.get('b1'))

    def test_pop_removes_persisted_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'batch_controls.json'
            store = BatchControlStore(filepath=str(path))
            store.set('b1', 'PAUSED')

            removed = store.pop('b1')
            self.assertEqual(removed, 'PAUSED')
            self.assertIsNone(BatchControlStore(filepath=str(path)).get('b1'))

    def test_missing_and_corrupt_file_load_as_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'batch_controls.json'
            # 文件不存在 → 空状态
            self.assertIsNone(BatchControlStore(filepath=str(path)).get('x'))

            # 文件损坏 → 空状态，不让服务起不来
            path.write_text('{not valid json', encoding='utf-8')
            self.assertIsNone(BatchControlStore(filepath=str(path)).get('x'))


if __name__ == '__main__':
    unittest.main()