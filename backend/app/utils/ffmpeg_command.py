import os


def _configured_executable(name: str) -> str:
    ffmpeg_bin_path = os.getenv('FFMPEG_BIN_PATH')
    if ffmpeg_bin_path:
        return os.path.join(ffmpeg_bin_path, name)
    return name


def ffmpeg_executable() -> str:
    """Return the configured ffmpeg executable or rely on PATH."""
    return _configured_executable('ffmpeg')


def ffprobe_executable() -> str:
    """Return the configured ffprobe executable or rely on PATH."""
    return _configured_executable('ffprobe')
