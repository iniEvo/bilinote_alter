"""
Phase-based task pipeline for BiliNote note generation.

Replaces the old single-thread-pool model where one worker ran the whole
sync chain (PARSING → DOWNLOADING → TRANSCRIBING → SUMMARIZING → SAVING),
blocking the worker during IO-bound phases (MLX transcription, LLM HTTP wait).

New model: three independent pools, each bounded by its own worker count:

    download_queue   (workers=PIPELINE_DOWNLOAD_WORKERS,   default 6)
    transcribe_queue (workers=PIPELINE_TRANSCRIBE_WORKERS, default 1)  # MLX single instance
    summarize_queue  (workers=PIPELINE_SUMMARIZE_WORKERS,  default 3)

Each phase writes its artifact cache ({task_id}_audio.json / _transcript.json /
markdown files) exactly as before, so phase boundaries are the existing
cache-file protocol — no new state format is introduced.

Batch pause/cancel is checked cooperatively at each phase entry: a task whose
batch was PAUSED/CANCELED is stamped and does not advance to the next queue.

Concurrency safety: phase callbacks and the finalize callback are registered
ONCE (process-wide, at startup) and are designed to be task-agnostic — all
per-task context travels inside the `params` dict passed to enqueue(). This
avoids the closure-overwrite race that a per-task re-registration would cause.
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from app.enmus.task_status_enums import TaskStatus
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


class TaskPipeline:
    """Three-stage cooperative pipeline for note generation tasks."""

    def __init__(self) -> None:
        self._download_workers = _env_int('PIPELINE_DOWNLOAD_WORKERS', 6)
        self._transcribe_workers = _env_int('PIPELINE_TRANSCRIBE_WORKERS', 1)
        self._summarize_workers = _env_int('PIPELINE_SUMMARIZE_WORKERS', 3)
        self._download_pool = ThreadPoolExecutor(
            max_workers=self._download_workers, thread_name_prefix='pipe-dl',
        )
        self._transcribe_pool = ThreadPoolExecutor(
            max_workers=self._transcribe_workers, thread_name_prefix='pipe-tx',
        )
        self._summarize_pool = ThreadPoolExecutor(
            max_workers=self._summarize_workers, thread_name_prefix='pipe-sm',
        )
        self._phase_callbacks: dict[str, Callable[..., Any]] = {}
        self._finalize_callback: Optional[Callable[[str], None]] = None
        self._lock = threading.Lock()
        logger.info(
            'TaskPipeline 初始化: download=%d transcribe=%d summarize=%d',
            self._download_workers, self._transcribe_workers, self._summarize_workers,
        )

    # ── 接线（启动时一次性注册）────────────────────────────────────
    def register_phase(
        self, phase: str, fn: Callable[..., Any],
    ) -> None:
        """注册某阶段的执行函数（进程级一次）。

        phase 取 'download' | 'transcribe' | 'summarize'。
        每个阶段函数必须：
        - 签名 fn(task_id: str, **params)，params 携带该阶段全部输入
        - 阶段入口检查批次控制（PAUSED/CANCELED，经 params['ctx']）
        - 执行自己的 IO/计算，写自己的产物缓存
        - 返回 (下一阶段参数 dict | None)：None 表示任务终止（失败/终态）
        - 失败时自己写好 FAILED/RETRYABLE 状态并返回 None
        """
        with self._lock:
            self._phase_callbacks[phase] = fn

    def register_finalize(self, fn: Callable[[str], None]) -> None:
        """注册任务终态回调（清理 in-flight 标记等）。"""
        with self._lock:
            self._finalize_callback = fn

    # ── 对外入口 ────────────────────────────────────────────────────
    def enqueue(self, task_id: str, params: dict[str, Any]) -> None:
        """把一个新任务送入下载阶段队列。

        params 必须包含该任务各阶段所需的全部输入；ctx 存放跨阶段上下文
        （batch_id / task_key / generation params）。
        """
        self._download_pool.submit(self._run_phase, 'download', task_id, params)

    # ── 阶段调度 ────────────────────────────────────────────────────
    def _run_phase(self, phase: str, task_id: str, params: dict[str, Any]) -> None:
        """在对应阶段池中执行 phase 函数，并把返回值交给下一阶段或收尾。"""
        try:
            fn = self._phase_callbacks.get(phase)
            if fn is None:
                logger.error('Pipeline 阶段 %s 未注册 (task_id=%s)', phase, task_id)
                self._finalize(task_id)
                return
            logger.info('Pipeline 阶段 %s 开始 (task_id=%s)', phase, task_id)
            result = fn(task_id=task_id, **params)
        except Exception as exc:
            logger.error('Pipeline 阶段 %s 异常 (task_id=%s): %s', phase, task_id, exc, exc_info=True)
            self._finalize(task_id)
            return

        if result is None:
            # 阶段内已写终态（FAILED/RETRYABLE/PAUSED/CANCELED），任务终止。
            logger.info('Pipeline 任务终止于阶段 %s (task_id=%s)', phase, task_id)
            self._finalize(task_id)
            return

        next_phase = {
            'download': 'transcribe',
            'transcribe': 'summarize',
        }.get(phase)
        if next_phase is None:
            # summarize 阶段是最后一段，result 为已完成的 NoteResult。
            logger.info('Pipeline 任务完成 (task_id=%s)', task_id)
            self._finalize(task_id)
            return

        # 进入下一阶段对应池
        logger.info('Pipeline 任务 %s: %s → %s', task_id, phase, next_phase)
        pool = self._pool_for(next_phase)
        # result dict 中的 task_id 由 pipeline 层单独传递，移除避免与 task_id= 冲突
        next_params = {k: v for k, v in result.items() if k != 'task_id'}
        next_params.setdefault('ctx', params.get('ctx'))
        pool.submit(self._run_phase, next_phase, task_id, next_params)

    def _pool_for(self, phase: str) -> ThreadPoolExecutor:
        return {
            'download': self._download_pool,
            'transcribe': self._transcribe_pool,
            'summarize': self._summarize_pool,
        }[phase]

    def _finalize(self, task_id: str) -> None:
        try:
            fn = self._finalize_callback
            if fn is not None:
                fn(task_id)
        except Exception as exc:
            logger.warning('Pipeline finalize 失败 (task_id=%s): %s', task_id, exc)

    def shutdown(self, wait: bool = True) -> None:
        for pool in (self._download_pool, self._transcribe_pool, self._summarize_pool):
            pool.shutdown(wait=wait)


# 进程级单例（与旧 task_serial_executor 同层级）
task_pipeline = TaskPipeline()