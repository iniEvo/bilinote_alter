import datetime
import json
import os
import re
import subprocess
import tempfile
import time
from typing import Union, Optional
from urllib.parse import parse_qs, quote, urlencode, urlparse

import httpx
import requests
import yt_dlp
from pydantic import BaseModel

from app.downloaders.base import Downloader
from app.utils.logger import get_logger
from app.downloaders.douyin_helper.abogus import ABogus
from app.enmus.note_enums import DownloadQuality
from app.exceptions.biz_exception import BizException
from app.models.audio_model import AudioDownloadResult
from app.services.cookie_manager import CookieConfigManager
from app.utils.path_helper import get_data_dir
from app.utils.url_parser import extract_video_id as extract_shared_video_id
from app.downloaders.yt_dlp_options import apply_ffmpeg_location
from app.utils.ffmpeg_command import ffmpeg_executable
from dotenv import load_dotenv

load_dotenv()
DOUYIN_DOMAIN = "https://www.douyin.com"
logger = get_logger(__name__)

cfm=CookieConfigManager()
def get_timestamp(unit: str = "milli"):
    """
    根据给定的单位获取当前时间 (Get the current time based on the given unit)

    Args:
        unit (str): 时间单位，可以是 "milli"、"sec"、"min" 等
            (The time unit, which can be "milli", "sec", "min", etc.)

    Returns:
        int: 根据给定单位的当前时间 (The current time based on the given unit)
    """

    now = datetime.datetime.utcnow() - datetime.datetime(1970, 1, 1)
    if unit == "milli":
        return int(now.total_seconds() * 1000)
    elif unit == "sec":
        return int(now.total_seconds())
    elif unit == "min":
        return int(now.total_seconds() / 60)
    else:
        raise ValueError("Unsupported time unit")


class DouyinConfig:
    HEADERS = {
        "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
        "Referer": "https://www.douyin.com/",
        "Cookie": None
    }

    PROXIES = {
        "http": None,
        "https": None,
    }

    MS_TOKEN = {
        "url": "https://mssdk.bytedance.com/web/report",
        "magic": 538969122,
        "version": 1,
        "dataType": 8,
        "strData": "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",
        "User-Agent": "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.47"
    }

    TTWID = {
        "url": "https://ttwid.bytedance.com/ttwid/union/register/",
        "data": '{"region":"cn","aid":1768,"needFid":false,"service":"www.ixigua.com","migrate_info":{"ticket":"","source":"node"},"cbUrlProtocol":"https","union":true}'
    }


class BaseRequestModel(BaseModel):
    device_platform: str = "webapp"
    aid: str = "6383"
    channel: str = "channel_pc_web"
    pc_client_type: int = 1
    version_code: str = "290100"
    version_name: str = "29.1.0"
    cookie_enabled: str = "true"
    screen_width: int = 1920
    screen_height: int = 1080
    browser_language: str = "zh-CN"
    browser_platform: str = "Win32"
    browser_name: str = "Chrome"
    browser_version: str = "130.0.0.0"
    browser_online: str = "true"
    engine_name: str = "Blink"
    engine_version: str = "130.0.0.0"
    os_name: str = "Windows"
    os_version: str = "10"
    cpu_core_num: int = 12
    device_memory: int = 8
    platform: str = "PC"
    downlink: str = "10"
    effective_type: str = "4g"
    from_user_page: str = "1"
    locate_query: str = "false"
    need_time_list: str = "1"
    pc_libra_divert: str = "Windows"
    publish_video_strategy_type: str = "2"
    round_trip_time: str = "0"
    show_live_replay_strategy: str = "1"
    time_list_query: str = "0"
    whale_cut_token: str = ""
    update_version_code: str = "170400"
    msToken: str = None


class DouyinDownloader(Downloader):
    def __init__(self, cookie=None):
        super().__init__()
        self._explicit_cookie = bool(cookie)
        self.headers_config = DouyinConfig.HEADERS.copy()
        self.headers_config["Cookie"] = cookie or cfm.get('douyin')
        self.proxies_config = DouyinConfig.PROXIES.copy()
        self.ttwid_config = DouyinConfig.TTWID.copy()
        self.ms_token_config = DouyinConfig.MS_TOKEN.copy()

    def _refresh_cookie(self) -> None:
        """每次请求前从配置文件读取最新 Cookie（配置更新后无需重启后端即生效）。

        SUPPORT_PLATFORM_MAP 中的下载器是进程级单例，__init__ 只执行一次；
        若用户更新了 Cookie 配置，不刷新会一直用进程启动时的旧 Cookie，
        导致重试/重新生成仍 403「Cookie 已失效」。
        """
        if self._explicit_cookie:
            return
        fresh = cfm.get('douyin')
        if fresh:
            self.headers_config["Cookie"] = fresh

    def _build_cookiefile(self) -> Optional[str]:
        cookie = self.headers_config.get('Cookie')
        if not cookie:
            return None

        cookie_lines = ["# Netscape HTTP Cookie File\n"]
        ignored_attrs = {'domain', 'path', 'expires', 'max-age', 'secure', 'httponly', 'samesite'}
        for pair in cookie.split(';'):
            pair = pair.strip()
            if not pair or '=' not in pair:
                continue
            key, value = pair.split('=', 1)
            key = key.strip().removeprefix('Cookie:').strip()
            value = value.strip()
            if not key or key.lower() in ignored_attrs:
                continue
            cookie_lines.append(f".douyin.com\tTRUE\t/\tTRUE\t0\t{key}\t{value}\n")

        if len(cookie_lines) == 1:
            return None

        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8')
        tmp.writelines(cookie_lines)
        tmp.close()
        return tmp.name

    def _extract_info_with_ytdlp(self, video_url: str, download: bool, output_dir: str) -> dict:
        output_template = os.path.join(output_dir, '%(id)s.%(ext)s')
        ydl_opts = {
            'noplaylist': True,
            'quiet': False,
            'outtmpl': output_template,
            'http_headers': {
                'Referer': self.headers_config.get('Referer', DOUYIN_DOMAIN),
                'User-Agent': self.headers_config.get('User-Agent', DouyinConfig.HEADERS['User-Agent']),
            },
        }
        if download:
            ydl_opts['format'] = 'bestaudio/best'
        else:
            ydl_opts['skip_download'] = True

        cookiefile = self._build_cookiefile()
        if cookiefile:
            ydl_opts['cookiefile'] = cookiefile

        apply_ffmpeg_location(ydl_opts)
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(video_url, download=download)
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc)
            if 'Fresh cookies' in message:
                raise BizException(
                    code=400002,
                    message='抖音 Cookie 已失效，请在设置中更新最新浏览器 Cookie 后重试',
                ) from exc
            raise ValueError(f'yt-dlp 获取抖音信息失败: {message}') from exc
        except yt_dlp.utils.PostProcessingError as exc:
            raise ValueError(f'yt-dlp 后处理失败: {exc}') from exc
        finally:
            if cookiefile and os.path.exists(cookiefile):
                os.remove(cookiefile)

    @staticmethod
    def find_url(string: str) -> list:
        return re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', string)

    def extract_video_id(self, url: str) -> str:
        shared_id = extract_shared_video_id(url, 'douyin')
        if shared_id:
            return shared_id

        video_urls = self.find_url(url)
        if not video_urls:
            return ''

        video_url = video_urls[0]
        try:
            response = requests.head(video_url, allow_redirects=True)
            resolved_url = response.url
        except Exception:
            resolved_url = video_url

        resolved_id = extract_shared_video_id(resolved_url, 'douyin')
        return resolved_id or ''

    def _normalize_video_url(self, video_url: str) -> str:
        aweme_id = self.extract_video_id(video_url)
        if aweme_id:
            return f'{DOUYIN_DOMAIN}/video/{aweme_id}'
        return video_url

    def gen_real_msToken(self) -> str:
        try:
            payload = json.dumps(
                {
                    "magic": self.ms_token_config["magic"],
                    "version": self.ms_token_config["version"],
                    "dataType": self.ms_token_config["dataType"],
                    "strData": self.ms_token_config["strData"],
                    "tspFromClient": get_timestamp(),
                }
            )
            headers = {
                "User-Agent": self.headers_config["User-Agent"],
                "Content-Type": "application/json",
            }
            transport = httpx.HTTPTransport(retries=5)
            with httpx.Client(transport=transport) as client:
                try:
                    response = client.post(
                        self.ms_token_config["url"], content=payload, headers=headers
                    )
                    response.raise_for_status()

                    msToken = str(httpx.Cookies(response.cookies).get("msToken"))
                    if len(msToken) not in [120, 128]:
                        raise ValueError("响应内容：{0}， Douyin msToken API 的响应内容不符合要求。".format(msToken))

                    return msToken
                except Exception as e:
                    raise ValueError("Douyin msToken API 请求失败：{0}".format(e))
        except Exception as e:
            raise ValueError("Douyin msToken API{0}".format(e))

    def fetch_video_info(self, video_url: str) -> json:
        try:
            self._refresh_cookie()
            aweme_id = self.extract_video_id(video_url)
            kwargs = self.headers_config
            base_params = BaseRequestModel().model_dump()
            base_params["msToken"] = self.gen_real_msToken()

            base_params["aweme_id"] = aweme_id
            bogus = ABogus()
            ab_value = bogus.get_value(base_params)
            a_bogus = quote(ab_value, safe='')
            query_str = urlencode(base_params)
            full_url = f"{DOUYIN_DOMAIN}/aweme/v1/web/aweme/detail/?{query_str}&a_bogus={a_bogus}"

            logger.info(
                "Douyin detail request prepared: aweme_id=%s cookie=%s msToken_len=%s",
                aweme_id or '<empty>',
                'present' if kwargs.get('Cookie') else 'missing',
                len(base_params['msToken']) if base_params.get('msToken') else 0,
            )

            response = requests.get(full_url, headers=kwargs)
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as exc:
                # 抖音对高频请求间歇性 403（风控），Cookie 有效也会随机触发。
                # 等待后重试（最多 3 次），把偶发 403 自动消化，避免任务直接失败。
                for attempt in range(2, 4):
                    logger.warning('Douyin detail 403, retry %d/3 after 3s...', attempt)
                    time.sleep(3)
                    response = requests.get(full_url, headers=kwargs)
                    try:
                        response.raise_for_status()
                        break
                    except requests.exceptions.HTTPError:
                        if attempt == 3:
                            raise

            try:
                data = response.json()
            except requests.exceptions.JSONDecodeError as e:
                preview = response.text[:200].strip()
                content_type = response.headers.get('content-type', '<missing>')
                logger.warning(
                    "Douyin detail returned non-JSON: aweme_id=%s status=%s content_type=%s body_preview=%r",
                    aweme_id or '<empty>',
                    response.status_code,
                    content_type,
                    preview,
                )
                raise BizException(
                    code=400001,
                    message=(
                        "抖音详情接口暂时不可用，请稍后重试，"
                        f"aweme_id={aweme_id or '<empty>'}"
                    ),
                ) from e

            detail = data.get('aweme_detail') if isinstance(data, dict) else None
            if not detail:
                logger.warning(
                    "Douyin detail missing aweme_detail: aweme_id=%s keys=%s body_preview=%r",
                    aweme_id or '<empty>',
                    sorted(data.keys()) if isinstance(data, dict) else type(data).__name__,
                    response.text[:200].strip(),
                )
                raise BizException(
                    code=400001,
                    message=(
                        "抖音详情接口未返回有效视频信息，请检查链接是否可访问或稍后重试，"
                        f"aweme_id={aweme_id or '<empty>'}"
                    ),
                )

            return data
        except BizException:
            raise
        except Exception as e:
            logger.error("Douyin detail request failed: %s", e)
            raise ValueError(f"请求失败: {e}") from e
        # print(kwargs)

    def download(
            self,
            video_url: str,
            output_dir: Union[str, None] = None,
            quality: DownloadQuality = "fast",
            need_video: Optional[bool] = False,
            skip_download: bool = False,
    ) -> AudioDownloadResult:
        if output_dir is None:
            output_dir = get_data_dir()
        if not output_dir:
            output_dir = self.cache_data
        os.makedirs(output_dir, exist_ok=True)
        self._refresh_cookie()

        # A previous interrupted run may already have downloaded the audio.
        # Reuse it before calling Douyin detail, which can reject old videos.
        cached_id = self.extract_video_id(video_url)
        cached_audio = os.path.join(output_dir, f'{cached_id}.mp3') if cached_id else None
        if cached_audio and os.path.exists(cached_audio) and os.path.getsize(cached_audio) > 0:
            logger.info('复用抖音音频缓存，跳过详情接口: %s', cached_audio)
            return AudioDownloadResult(
                file_path=cached_audio,
                title=cached_id,
                duration=0,
                cover_url=None,
                platform='douyin',
                video_id=cached_id,
                raw_info={'tags': ''},
                video_path=None,
            )

        video_data = self.fetch_video_info(video_url)
        detail = video_data['aweme_detail']
        tags = [tag.get('tag_name') for tag in detail.get('video_tag', []) if tag.get('tag_name')]
        title = detail.get('item_title') or detail.get('desc') or detail.get('caption') or detail['aweme_id']
        duration = detail.get('video', {}).get('duration', 0)
        cover_url = None
        if detail.get('video', {}).get('cover_original_scale'):
            cover_url = detail['video']['cover_original_scale']['url_list'][0]
        elif detail.get('video', {}).get('cover'):
            cover_url = detail['video']['cover']['url_list'][0]

        if skip_download:
            return AudioDownloadResult(
                file_path=os.path.join(output_dir, f"{detail['aweme_id']}.mp3"),
                title=title,
                duration=duration,
                cover_url=cover_url,
                platform='douyin',
                video_id=detail['aweme_id'],
                raw_info={'tags': detail.get('caption', '') + ''.join(tags)},
                video_path=None,
            )

        normalized_video_url = self._normalize_video_url(video_url)
        info = None
        media_url = None
        media_ext = 'mp4'
        try:
            info = self._extract_info_with_ytdlp(normalized_video_url, download=False, output_dir=output_dir)
            media_url = info.get('url')
            media_ext = info.get('ext') or 'mp4'
        except Exception as exc:
            # yt-dlp 抖音 extractor 常因缺少 a_bogus 签名 / 风控返回 403 并误报
            # "Fresh cookies"，此时 Cookie 其实有效（fetch_video_info 已成功）。
            # 不能抛错——必须回退到下方详情接口的 download_addr 直连下载。
            logger.warning('Douyin audio yt-dlp failed (%s), fallback to download_addr', exc)
            media_url = None

        if not media_url:
            addr = detail.get('video', {}).get('download_addr', {}).get('url_list') or []
            if not addr:
                raise ValueError('请求失败: 未获取到抖音媒体下载地址')
            media_url = addr[0]

        media_path = os.path.join(output_dir, f"{detail['aweme_id']}.{media_ext}")
        response = requests.get(media_url, headers=self.headers_config, stream=True)
        response.raise_for_status()
        with open(media_path, 'wb') as f:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    f.write(chunk)

        audio_path = media_path
        if media_ext != 'mp3':
            audio_path = os.path.join(output_dir, f"{detail['aweme_id']}.mp3")
            subprocess.run(
                [ffmpeg_executable(), '-y', '-i', media_path, '-vn', '-acodec', 'libmp3lame', audio_path],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        return AudioDownloadResult(
            file_path=audio_path,
            title=(info or {}).get('title') or title,
            duration=(info or {}).get('duration', duration),
            cover_url=(info or {}).get('thumbnail') or cover_url,
            platform='douyin',
            video_id=(info or {}).get('id') or detail['aweme_id'],
            raw_info={'tags': (info or {}).get('tags') or detail.get('caption', '') + ''.join(tags)},
            video_path=None,
        )

    def download_video(self, video_url: str, output_dir: Union[str, None] = None) -> str:
        if output_dir is None:
            output_dir = get_data_dir()
        if not output_dir:
            output_dir = self.cache_data
        os.makedirs(output_dir, exist_ok=True)
        self._refresh_cookie()

        video_id = self.extract_video_id(video_url)
        video_path = os.path.join(output_dir, f"{video_id}.mp4")
        if os.path.exists(video_path):
            return video_path

        normalized_video_url = self._normalize_video_url(video_url)

        try:
            info = self._extract_info_with_ytdlp(normalized_video_url, download=True, output_dir=output_dir)
            video_id = info.get('id') or video_id
            video_path = os.path.join(output_dir, f"{video_id}.mp4")
            if os.path.exists(video_path):
                return video_path
        except Exception as exc:
            # yt-dlp 抖音 extractor 常因缺少 a_bogus 签名 / 风控返回 403 并误报
            # "Fresh cookies"，此时 Cookie 其实是好的（fetch_video_info 能成功）。
            # 不能在这里 raise——必须回退到下方 requests 直连路径。
            logger.warning('Douyin video yt-dlp failed (%s), fallback to legacy API', exc)

        try:
            video_data = self.fetch_video_info(video_url)
            output_path = os.path.join(output_dir, f"{video_data['aweme_detail']['aweme_id']}.mp4")
            url = video_data['aweme_detail']['video']['download_addr']['url_list'][0]
            data = requests.get(url, allow_redirects=True, headers=self.headers_config)
            data.raise_for_status()
            with open(output_path, 'wb') as f:
                f.write(data.content)
            return output_path
        except BizException:
            raise
        except Exception as e:
            raise ValueError(f"请求失败: {e}") from e



if __name__ == '__main__':
    dy = DouyinDownloader(
        cookie='')

    dy.download(
        '7.43 11/16 gba:/ j@P.xS 以“马成钢”的视角打开《抓娃娃》笼中鸟，何时飞 # 独白 # 人物故事  https://v.douyin.com/0pcFVdG_lx4/ 复制此链接，打开Dou音搜索，直接观看视频！'
    )
