import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from app.utils.path_helper import resolve_app_path

logger = logging.getLogger(__name__)


class BinPathsConfigManager:
    """外部二进制 / 模型的路径配置，存 JSON 文件（config/bin_paths.json）。

    让部署监控页可以手动指定 FFmpeg 与 Whisper 模型的位置，解决
    「装了但不在 PATH / 模型目录不在默认位置」时后台检测不到的问题。

    配置结构：
    {
        "ffmpeg_path": "",        # ffmpeg 可执行文件完整路径（留空 = 环境变量/PATH 自动检测）
        "whisper_model_dir": ""   # whisper 模型父目录（留空 = 默认 backend/models）
    }
    """

    def __init__(self, filepath: Optional[str] = None):
        # 锚定到后端目录（main.py 所在目录），与启动 CWD 无关
        self.path = Path(resolve_app_path(filepath or "config/bin_paths.json"))
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.warning("读取路径配置失败，回退为空配置")
            return {}

    def _write(self, data: Dict[str, Any]):
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_config(self) -> Dict[str, Any]:
        data = self._read()
        return {
            "ffmpeg_path": str(data.get("ffmpeg_path") or "").strip(),
            "whisper_model_dir": str(data.get("whisper_model_dir") or "").strip(),
        }

    def update_config(self, ffmpeg_path: Optional[str] = None, whisper_model_dir: Optional[str] = None) -> Dict[str, Any]:
        """更新路径配置并持久化。传入 None/空串表示清除该配置项（恢复自动检测）。"""
        data = self._read()
        if ffmpeg_path is not None:
            data["ffmpeg_path"] = ffmpeg_path.strip()
        if whisper_model_dir is not None:
            data["whisper_model_dir"] = whisper_model_dir.strip()

        # 轻量校验：配置非空时确保可落地
        if data.get("ffmpeg_path"):
            p = Path(data["ffmpeg_path"])
            if p.is_dir():
                raise ValueError(f"FFmpeg 路径不能是目录，请填写 ffmpeg 可执行文件完整路径（如 /usr/local/bin/ffmpeg）: {p}")
        if data.get("whisper_model_dir"):
            target = Path(resolve_app_path(data["whisper_model_dir"]))
            try:
                target.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ValueError(f"Whisper 模型目录无法创建: {data['whisper_model_dir']}（{exc}）") from exc
            if not target.is_dir():
                raise ValueError(f"Whisper 模型目录无效: {data['whisper_model_dir']}")

        self._write(data)
        return self.get_config()