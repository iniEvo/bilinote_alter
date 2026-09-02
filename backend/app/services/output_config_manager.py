import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from app.utils.path_helper import resolve_app_path

logger = logging.getLogger(__name__)


class OutputConfigManager:
    """生成物输出目录配置，存 JSON 文件，支持前端动态修改。

    目前只管理「Markdown 导出副本」的落盘目录（note_results/*.md）。

    目录解析口径与历史环境变量保持一致：
      - 空字符串 / 未配置 → 使用默认目录（NOTE_OUTPUT_DIR，来自 env 或 backend/note_results）
      - 绝对路径 → 原样使用（支持 ~ 展开）
      - 相对路径 → 锚定到后端目录（APP_ROOT，即 main.py 所在目录）

    优先级：本配置文件 > 环境变量 NOTE_OUTPUT_DIR > 默认 backend/note_results。
    """

    def __init__(self, filepath: Optional[str] = None):
        # 锚定到后端目录（main.py 所在目录），与启动 CWD 无关
        self.path = Path(resolve_app_path(filepath or "config/output.json"))
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.warning("读取输出目录配置失败，回退为空配置")
            return {}

    def _write(self, data: Dict[str, Any]):
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_config(self) -> Dict[str, Any]:
        data = self._read()
        return {
            "markdown_output_dir": str(data.get("markdown_output_dir") or "").strip(),
        }

    def get_markdown_output_dir(self) -> Optional[Path]:
        """返回配置的 Markdown 落盘目录；None 表示未配置（应使用默认目录）。

        会尝试确保目录可写；创建失败（无权限 / 指向非目录）时记录告警并返回 None，
        让调用方回退到默认目录，避免把任务搞挂。
        """
        raw = self.get_config()["markdown_output_dir"]
        if not raw:
            return None
        target = Path(resolve_app_path(raw))
        try:
            target.mkdir(parents=True, exist_ok=True)
            if not target.is_dir():
                logger.warning(f"输出目录不是一个目录，回退默认: {target}")
                return None
            return target
        except Exception as exc:
            logger.warning(f"创建/校验输出目录失败，回退默认 ({target}): {exc}")
            return None

    def update_config(self, markdown_output_dir: Optional[str]) -> Dict[str, Any]:
        """更新 Markdown 输出目录并持久化。

        传入空字符串 / None 表示恢复默认目录。
        """
        raw = str(markdown_output_dir or "").strip()
        data = self._read()
        data["markdown_output_dir"] = raw

        # 校验：仅当配置了非空值时做一次落盘确认，尽早暴露「路径不可用」问题
        if raw:
            target = Path(resolve_app_path(raw))
            target.mkdir(parents=True, exist_ok=True)
            if not target.is_dir():
                raise ValueError(f"输出目录无效：{raw} 不是一个可用的目录")

        self._write(data)
        return self.get_config()