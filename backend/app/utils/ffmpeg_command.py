import os


def _resolve_ffmpeg_base() -> str:
    """返回 ffmpeg 所在目录或基础路径。

    优先级：手动配置的完整路径（config/bin_paths.json）> 环境变量 FFMPEG_BIN_PATH。
    FFMPEG_BIN_PATH 历史上是「目录」语义，但用户可能填 shim 文件路径（如
    `which ffmpeg` 的结果），两种都兼容：
      - 若是文件 → 视为可执行文件本身，返回其目录 + 文件名提示
      - 若是目录 → 返回目录
    """
    try:
        from app.services.bin_paths_config_manager import BinPathsConfigManager

        configured = BinPathsConfigManager().get_config().get("ffmpeg_path", "")
        if configured:
            return configured
    except Exception:
        pass
    return os.getenv('FFMPEG_BIN_PATH') or ''


def _configured_executable(name: str) -> str:
    base = _resolve_ffmpeg_base()
    if not base:
        return name
    # 若 base 本身是一个可执行文件（shim / 完整路径）：
    #   - 请求的正是该文件 → 直接返回
    #   - 请求的是同目录兄弟（ffprobe ↔ ffmpeg）→ 目录 + 文件名
    if os.path.isfile(base):
        if os.path.basename(base) == name:
            return base
        return os.path.join(os.path.dirname(base), name)
    # 若 base 是目录 → 按目录语义拼接 ffmpeg/ffprobe
    if os.path.isdir(base):
        return os.path.join(base, name)
    # base 不存在 → 原样返回（前端展示用户填写的路径，一眼看出填错）
    return base


def ffmpeg_base_dir() -> str:
    """配置的 ffmpeg 基础位置（目录）；若配置的是可执行文件则返回其所在目录。空字符串 = 未配置。"""
    base = _resolve_ffmpeg_base()
    if base and os.path.isfile(base):
        return os.path.dirname(base)
    return base


def ffmpeg_executable() -> str:
    """Return the configured ffmpeg executable or rely on PATH."""
    return _configured_executable('ffmpeg')


def ffprobe_executable() -> str:
    """Return the configured ffprobe executable or rely on PATH."""
    return _configured_executable('ffprobe')
