from typing import Any

from app.utils.ffmpeg_command import ffmpeg_base_dir


def apply_ffmpeg_location(ydl_opts: dict[str, Any]) -> dict[str, Any]:
    """Pass an explicit ffmpeg directory to yt-dlp when configured.

    兼容三类来源：环境变量 FFMPEG_BIN_PATH（目录或可执行文件）、
    手动配置 bin_paths.json 的 ffmpeg_path。yt-dlp 的 ffmpeg_location
    只接受目录，因此把文件路径归一化为所在目录。
    """
    base = ffmpeg_base_dir()
    if base:
        ydl_opts['ffmpeg_location'] = base
    return ydl_opts
