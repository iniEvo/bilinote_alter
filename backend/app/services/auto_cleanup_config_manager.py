import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.utils.path_helper import resolve_app_path

logger = logging.getLogger(__name__)

# 自动清理可纳入范围的生成物 key 白名单（与 artifacts 登记表的 deletable 条目对齐）。
# 不含 note_json（不可删除）与 markdown_notes（用户习惯手动导出，默认不勾选，可勾选）。
AUTO_CLEANABLE_KEYS = [
    "transcript_json",      # 音频转写文本
    "task_state_json",      # 任务状态与中间 JSON
    "video_audio_cache",    # 视频 / 音频缓存
    "screenshots",          # 笔记配图截图
    "frame_artifacts",      # 视频抽帧产物
    "uploads",              # 本地上传文件
    "markdown_notes",       # Markdown 导出副本
]


class AutoCleanupConfigManager:
    """自动清理配置，存 JSON 文件（config/auto_cleanup.json），支持前端动态修改。

    配置结构：
    {
        "enabled": false,            # 总开关
        "interval_hours": 24,        # 清理周期（小时）
        "keys": ["video_audio_cache", "screenshots"],  # 纳入自动清理范围的生成物 key
        "last_run_at": null,         # 上次成功执行时间（ISO 8601）
    }
    """

    def __init__(self, filepath: Optional[str] = None):
        # 锚定到后端目录（main.py 所在目录），与启动 CWD 无关
        self.path = Path(resolve_app_path(filepath or "config/auto_cleanup.json"))
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.warning("读取自动清理配置失败，回退为空配置")
            return {}

    def _write(self, data: Dict[str, Any]):
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_config(self) -> Dict[str, Any]:
        data = self._read()
        keys = data.get("keys") or []
        # 过滤掉不在白名单内的 key，防止配置被手工改坏后清理到不可删条目
        keys = [k for k in keys if k in AUTO_CLEANABLE_KEYS]
        # 去重保序
        seen = set()
        keys = [k for k in keys if not (k in seen or seen.add(k))]
        interval = int(data.get("interval_hours") or 24)
        if interval < 1:
            interval = 1
        if interval > 24 * 365:
            interval = 24 * 365
        return {
            "enabled": bool(data.get("enabled", False)),
            "interval_hours": interval,
            "keys": keys,
            "last_run_at": data.get("last_run_at") or None,
        }

    def update_config(
        self,
        enabled: bool,
        interval_hours: int,
        keys: List[str],
    ) -> Dict[str, Any]:
        """更新自动清理配置并持久化。"""
        data = self._read()
        data["enabled"] = bool(enabled)
        data["interval_hours"] = max(1, int(interval_hours))
        # 只保留白名单内的 key
        data["keys"] = [k for k in keys if k in AUTO_CLEANABLE_KEYS]
        self._write(data)
        return self.get_config()

    def mark_run(self):
        """记录上次执行时间。"""
        from datetime import datetime, timezone

        data = self._read()
        data["last_run_at"] = datetime.now(timezone.utc).isoformat()
        self._write(data)
