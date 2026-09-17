from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Any, Callable


class ConcurrentTaskExecutor:
    """使用线程池并发执行任务（已弃用，保留仅为兼容旧测试/引用）。

    新架构见 app.services.task_pipeline.TaskPipeline：三阶段队列
    （下载/转写/总结）各自独立并发，取代本类"单线程池跑整条同步链"的模型。
    主流程已不再引用本类；run_note_task 改为向 pipeline 入队。
    """

    def __init__(self, max_workers: int | None = None):
        self._max_workers = max_workers or int(os.getenv("TASK_MAX_WORKERS", "3"))
        self._pool = ThreadPoolExecutor(max_workers=self._max_workers)

    def run(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        future: Future = self._pool.submit(fn, *args, **kwargs)
        return future.result()

    def shutdown(self, wait: bool = True):
        self._pool.shutdown(wait=wait)


# 保持向后兼容的导出名
SerialTaskExecutor = ConcurrentTaskExecutor
task_serial_executor = ConcurrentTaskExecutor()
