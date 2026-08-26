"""批次控制态的持久化存储。

批次「暂停 / 取消 / 继续」原本只存在进程内存里（note.py 的 _batch_task_controls），
后端重启即丢失，导致 PAUSED / CANCELED 状态漂移：暂停中的批次在重启后会被前端
按 pending 数量误判为 RUNNING。这里改为 JSON 文件落盘，锚定到后端目录下的
config/batch_controls.json（与 transcriber.json / downloader.json 同一机制）。

语义约定：
- PAUSED / CANCELED 会被持久化，重启后仍能拦截批次任务；
- RUNNING 是默认态，不落盘——把批次标记回 RUNNING 等价于删除其持久化条目，
  从而保证重启后 RUNNING 批次自然继续执行，无需额外状态。
"""
import json
import logging
from pathlib import Path
from threading import Lock
from typing import Optional

from app.utils.path_helper import resolve_app_path

logger = logging.getLogger(__name__)


class BatchControlStore:
    """线程安全的批次控制态存储，进程内缓存 + JSON 文件落盘。"""

    def __init__(self, filepath: Optional[str] = None):
        self.path = Path(resolve_app_path(filepath or 'config/batch_controls.json'))
        self._lock = Lock()
        self._state: dict[str, str] = self._load()

    def _load(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open('r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as exc:  # 文件损坏时按空状态启动，不让服务起不来
            logger.warning('读取批次控制态失败，按空状态启动：%s', exc)
            return {}

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open('w', encoding='utf-8') as f:
                json.dump(self._state, f, ensure_ascii=False, indent=2)
        except Exception as exc:  # 落盘失败不阻断本次进程内运行
            logger.warning('持久化批次控制态失败：%s', exc)

    def get(self, batch_id: str) -> Optional[str]:
        with self._lock:
            return self._state.get(batch_id)

    def set(self, batch_id: str, state: str) -> None:
        with self._lock:
            if state == 'RUNNING':
                # RUNNING 是默认态，删除持久化标记即回到默认
                if self._state.pop(batch_id, None) is not None:
                    self._save()
                return
            if self._state.get(batch_id) == state:
                return
            self._state[batch_id] = state
            self._save()

    def pop(self, batch_id: str) -> Optional[str]:
        with self._lock:
            removed = self._state.pop(batch_id, None)
            if removed is not None:
                self._save()
            return removed