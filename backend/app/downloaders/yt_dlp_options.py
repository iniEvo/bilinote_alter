import os
from typing import Any


def apply_ffmpeg_location(ydl_opts: dict[str, Any]) -> dict[str, Any]:
    """Pass an explicit ffmpeg directory to yt-dlp when configured."""
    ffmpeg_bin_path = os.getenv('FFMPEG_BIN_PATH')
    if ffmpeg_bin_path:
        ydl_opts['ffmpeg_location'] = ffmpeg_bin_path
    return ydl_opts
