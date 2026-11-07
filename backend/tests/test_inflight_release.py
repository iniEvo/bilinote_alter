"""in-flight 标记释放的回归测试（走真实 run_note_task 注册路径）。

背景 bug：pipeline 的 finalize 槽位只有一个，而 run_note_task 曾为每个任务
注册一个「捕获自己 task_key」的闭包。批量并发提交时后注册的覆盖先注册的，
于是除最后一个之外的任务结束时都拿别人的 task_key 比对，条件不成立，
_inflight_video_tasks 里对应标记永久泄漏 —— 那些视频此后一直被
/generate_note 判定为「正在生成中」（code 300103）而无法重新生成，
直到重启后端。

因此本测试必须真实调用 run_note_task（而不是直接调用 _pipeline_finalize），
否则绕过了出问题的那行注册代码，测不出这个 bug。
"""
import pathlib
import sys
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.modules.setdefault('faster_whisper', types.SimpleNamespace(WhisperModel=object))

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.routers import note  # noqa: E402
from app.services.task_pipeline import TaskPipeline  # noqa: E402


class TestRunNoteTaskInflight(unittest.TestCase):
    def setUp(self):
        self.pipeline = TaskPipeline()
        # 阶段全部「立即终止」，只关心 finalize 是否被正确触发
        self.pipeline.register_phase('download', lambda task_id, ctx=None, **params: None)
        self.pipeline.register_phase('transcribe', lambda task_id, ctx=None, **params: None)
        self.pipeline.register_phase('summarize', lambda task_id, ctx=None, **params: None)
        # 模拟 main.py 启动时的一次性注册
        self.pipeline.register_finalize(note._pipeline_finalize)

        with note._video_task_lock:
            self._saved_inflight = dict(note._inflight_video_tasks)
            note._inflight_video_tasks.clear()

    def tearDown(self):
        self.pipeline.shutdown(wait=True)
        with note._video_task_lock:
            note._inflight_video_tasks.clear()
            note._inflight_video_tasks.update(self._saved_inflight)

    def _run_task(self, index):
        """真实调用 run_note_task，模拟一次并发提交。"""
        task_id = f'task-{index}'
        video_id = f'video-{index}'
        task_key = ('douyin', video_id)
        with note._video_task_lock:
            note._inflight_video_tasks[task_key] = task_id

        row = SimpleNamespace(batch_id=None, batch_name=None)
        with patch.object(note, 'task_pipeline', self.pipeline), \
             patch.object(note, 'get_task_record', return_value=row):
            note.run_note_task(
                task_id=task_id,
                video_url=f'https://www.douyin.com/video/{video_id}',
                platform='douyin',
                quality='fast',
                model_name='m',
                provider_id='p',
                video_id=video_id,
            )
        return task_id, task_key

    def _wait_until(self, predicate, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.02)
        return False

    def test_all_concurrent_markers_released(self):
        """核心回归：并发 3 个任务，3 个标记都要释放（修复前只有 1 个会释放）。"""
        total = 3
        for index in range(total):
            self._run_task(index)

        released = self._wait_until(
            lambda: not note._inflight_video_tasks,
        )

        with note._video_task_lock:
            leaked = dict(note._inflight_video_tasks)
        self.assertTrue(released, f'并发任务结束后不应残留 in-flight 标记，实际残留: {leaked}')

    def test_single_task_marker_released(self):
        task_id, task_key = self._run_task(0)
        self._wait_until(lambda: not note._inflight_video_tasks)
        with note._video_task_lock:
            self.assertNotIn(task_key, note._inflight_video_tasks)

    def test_registration_is_not_overwritten_per_task(self):
        """run_note_task 不应注册 finalize 回调。

        pipeline 的 finalize 是单槽位；若每个任务都注册闭包，并发时会互相
        覆盖并泄漏标记。这里断言回调始终保持为启动时注册的那个
        （_pipeline_finalize），而不是被任务级闭包替换。
        """
        self._run_task(0)
        self._run_task(1)
        self.assertIs(
            self.pipeline._finalize_callback,
            note._pipeline_finalize,
            'finalize 回调不应被任务级闭包覆盖（这正是标记泄漏的根因）',
        )


if __name__ == '__main__':
    unittest.main()
