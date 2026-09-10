import threading
import time
from datetime import datetime, timezone
from typing import List

from app.services.auto_cleanup_config_manager import AutoCleanupConfigManager
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 调度器运行的最小检查间隔（秒）。配置的 interval_hours 是清理周期，
# 线程每次醒来都检查「是否到点」，不需要精确对齐到整点。
_CHECK_INTERVAL_SECONDS = 60

# 防止上次清理未结束就进入下一轮（例如 17MB 的 batch 全量扫描很慢）。
_RUN_LOCK = threading.Lock()


class AutoCleanupScheduler:
    """自动清理调度器：后台线程按配置周期清理选中的生成物。

    - 配置关闭（enabled=False）时不清理；
    - 配置周期到达（距上次执行 >= interval_hours）时清理一次；
    - 清理范围取配置里的 keys，逐个走 artifacts 清理逻辑（deletable 校验兜底）；
    - 每次成功执行后更新 last_run_at；
    - 进程退出时线程自然消亡（daemon=True）。
    """

    def __init__(self):
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="auto-cleanup", daemon=True)
        self._thread.start()
        logger.info("[auto-cleanup] 调度线程已启动")

    def stop(self):
        self._stop.set()

    def _loop(self):
        while not self._stop.wait(_CHECK_INTERVAL_SECONDS):
            try:
                self._tick()
            except Exception:
                logger.exception("[auto-cleanup] 调度循环异常")

    def _tick(self):
        cfg = AutoCleanupConfigManager().get_config()
        if not cfg["enabled"]:
            return
        if not cfg["keys"]:
            return

        interval_seconds = cfg["interval_hours"] * 3600
        last_run = cfg.get("last_run_at")
        if last_run:
            try:
                last_dt = datetime.fromisoformat(last_run)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - last_dt).total_seconds() < interval_seconds:
                    return
            except (ValueError, TypeError):
                # last_run_at 损坏时按「从未执行过」处理，直接清理一次
                pass

        result = self.run_cleanup(cfg["keys"])
        # 只有调度触发的清理才推进 last_run_at；手动「立即执行」不改变周期节奏
        if result.get("skipped") != "busy":
            AutoCleanupConfigManager().mark_run()

    def run_cleanup(self, keys: List[str]) -> dict:
        """立即执行一次清理（也被「立即清理」接口复用）。返回各 key 结果。"""
        if not _RUN_LOCK.acquire(blocking=False):
            logger.warning("[auto-cleanup] 上一次清理仍在进行，跳过本次")
            return {"results": [], "skipped": "busy"}

        try:
            # 延迟 import 避免循环依赖（artifacts 路由不依赖本模块）
            from app.routers.artifacts import _clear_item, _resolve_meta_by_key

            results = []
            for key in keys:
                meta = _resolve_meta_by_key(key)
                if meta is None:
                    results.append({"key": key, "status": "refused", "msg": f"未知的生成物类型: {key}"})
                    continue
                if not meta["deletable"]:
                    results.append({"key": key, "status": "refused", "msg": "该生成物不允许批量清理"})
                    continue
                try:
                    freed, removed = _clear_item(meta)
                    logger.info(f"[auto-cleanup] 清理 {key}: 删除 {removed} 个文件，释放 {freed} 字节")
                    results.append({
                        "key": key,
                        "status": "done",
                        "removed_files": removed,
                        "freed_bytes": freed,
                        "msg": f"已删除 {removed} 个文件，释放 {freed / 1024 / 1024:.2f} MB",
                    })
                except Exception as e:
                    logger.exception(f"[auto-cleanup] 清理 {key} 失败")
                    results.append({"key": key, "status": "error", "msg": str(e)})
            return {"results": results, "skipped": None}
        finally:
            _RUN_LOCK.release()


auto_cleanup_scheduler = AutoCleanupScheduler()
