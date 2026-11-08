from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AudioDownloadResult:
    file_path: str               # 本地音频路径
    title: str                   # 视频标题
    duration: float              # 视频时长（秒）
    cover_url: Optional[str]     # 视频封面图
    platform: str                # 平台，如 "bilibili"
    video_id: str                # 唯一视频ID
    raw_info: dict               # yt-dlp 的原始 info 字典
    video_path: Optional[str] = None  #  新增字段：可选视频文件路径
    author: Optional[str] = None       # 作者/博主昵称（用于校验 batch 归属）
    author_unique_id: Optional[str] = None  # 作者唯一 ID（抖音 unique_id / B站 mid 等）

