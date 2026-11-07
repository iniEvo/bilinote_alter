"""Pipeline 终态回调的并发正确性回归测试。

背景（真实 bug）：register_finalize 是单槽位，而 run_note_task 曾为每个任务
注册一个「捕获自己 task_key」的闭包。批量并发提交时后注册的会覆盖先注册的，
于是除最后一个之外的任务在结束时都拿别人的 task_key 去比对，条件不成立，
in-flight 标记永久泄漏 —— 对应视频此后一直被判定为「正在生成中」，
直到重启后端才能再次生成笔记。

修法：改为启动时注册一次任务无关的回调，由 pipeline 把 ctx（含 task_key）
透传给回调。本测试锁住这个契约。
"""
import pathlib
import sys
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.services.task_pipeline import TaskPipeline  # noqa: E402


class _FakePhase:
    """记录每次阶段调用的 task_id，便于断言。"""

    def __init__(self):
        self.calls = []
        self.lock = threading.Lock()

    def __call__(self, task_id, ctx=None, **params):
        with self.lock:
            self.calls.append(task_id)
        return {'ctx': ctx}


class TestPipelineFinalizeReceivesCtx(unittest.TestCase):
    def setUp(self):
        self.pipeline = TaskPipeline()

    def tearDown(self):
        self.pipeline.shutdown(wait=True)

    def test_finalize_callback_receives_ctx_for_every_task(self):
        """并发任务各自的 ctx 都要送达回调，不能被后注册的覆盖。"""
        download = _FakePhase()
        summarize = _FakePhase()
        self.pipeline.register_phase('download', download)
        self.pipeline.register_phase('summarize', summarize)

        seen = []
        seen_lock = threading.Lock()

        def on_finalize(task_id, ctx=None):
            with seen_lock:
                seen.append((task_id, (ctx or {}).get('task_key')))

        self.pipeline.register_finalize(on_finalize)

        submitted = 3
        for index in range(submitted):
            task_id = f'task-{index}'
            self.pipeline.enqueue(task_id, {
                'ctx': {'task_key': ('douyin', f'video-{index}')},
            })

        deadline = time.time() + 5
        while time.time() < deadline:
            with seen_lock:
                if len(seen) >= submitted:
                    break
            time.sleep(0.02)

        got = dict(seen)
        self.assertEqual(len(got), submitted, f'每个任务都应触发一次 finalize，实际 {seen}')
        for index in range(submitted):
            self.assertEqual(
                got.get(f'task-{index}'),
                ('douyin', f'video-{index}'),
                f'task-{index} 的 ctx 必须与自身匹配（互不覆盖）',
            )

    def test_finalize_tolerates_missing_ctx(self):
        """ctx 缺失时不应抛异常，回调仍需被调用一次。"""
        self.pipeline.register_phase('download', _FakePhase())
        self.pipeline.register_phase('summarize', _FakePhase())

        calls = []

        def on_finalize(task_id, ctx=None):
            calls.append((task_id, ctx))

        self.pipeline.register_finalize(on_finalize)
        self.pipeline.enqueue('task-noctx', {})

        deadline = time.time() + 5
        while time.time() < deadline and not calls:
            time.sleep(0.02)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'task-noctx')
        self.assertIsNone(calls[0][1])

    def test_single_slot_means_last_registration_wins(self):
        """固化「单槽位」这一事实：这是必须任务无关注册的根本原因。"""
        self.pipeline.register_phase('download', _FakePhase())
        self.pipeline.register_phase('summarize', _FakePhase())

        first = []
        second = []
        self.pipeline.register_finalize(lambda task_id, ctx=None: first.append(task_id))
        self.pipeline.register_finalize(lambda task_id, ctx=None: second.append(task_id))

        self.pipeline.enqueue('t1', {'ctx': {'task_key': ('p', 'v')}})

        deadline = time.time() + 5
        while time.time() < deadline and not second:
            time.sleep(0.02)

        self.assertEqual(first, [], '先注册的回调会被覆盖，不应被调用')
        self.assertEqual(second, ['t1'])


if __name__ == '__main__':
    unittest.main()
