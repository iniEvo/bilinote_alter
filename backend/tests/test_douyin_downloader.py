import os
from unittest.mock import Mock, patch

import requests

from app.downloaders.douyin_downloader import DouyinDownloader
from app.exceptions.biz_exception import BizException
from app.utils.url_parser import extract_video_id


@patch.object(DouyinDownloader, 'extract_video_id', return_value='7676422267886259510')
@patch.object(DouyinDownloader, 'gen_real_msToken', return_value='x' * 120)
@patch('app.downloaders.douyin_downloader.ABogus.get_value', return_value='bogus')
@patch('app.downloaders.douyin_downloader.requests.get')
def test_fetch_video_info_raises_biz_exception_for_non_json(
    mock_get,
    _mock_bogus,
    _mock_ms_token,
    _mock_extract,
):
    response = Mock()
    response.status_code = 200
    response.headers = {'content-type': 'text/plain; charset=utf-8'}
    response.text = ''
    response.raise_for_status.return_value = None
    response.json.side_effect = requests.exceptions.JSONDecodeError('Expecting value', '', 0)
    mock_get.return_value = response

    downloader = DouyinDownloader()

    try:
        downloader.fetch_video_info('https://www.douyin.com/video/7676422267886259510')
        assert False, 'expected BizException'
    except BizException as exc:
        assert exc.code == 400001
        assert '抖音详情接口暂时不可用' in exc.message
        assert '7676422267886259510' in exc.message


@patch.object(DouyinDownloader, 'extract_video_id', return_value='7676422267886259510')
@patch.object(DouyinDownloader, 'gen_real_msToken', return_value='x' * 120)
@patch('app.downloaders.douyin_downloader.ABogus.get_value', return_value='bogus')
@patch('app.downloaders.douyin_downloader.requests.get')
def test_fetch_video_info_raises_biz_exception_for_missing_aweme_detail(
    mock_get,
    _mock_bogus,
    _mock_ms_token,
    _mock_extract,
):
    response = Mock()
    response.status_code = 200
    response.headers = {'content-type': 'application/json'}
    response.text = '{"status_code": 0}'
    response.raise_for_status.return_value = None
    response.json.return_value = {'status_code': 0}
    mock_get.return_value = response

    downloader = DouyinDownloader()

    try:
        downloader.fetch_video_info('https://www.douyin.com/video/7676422267886259510')
        assert False, 'expected BizException'
    except BizException as exc:
        assert exc.code == 400001
        assert '未返回有效视频信息' in exc.message
        assert '7676422267886259510' in exc.message


@patch.object(DouyinDownloader, 'fetch_video_info')
@patch.object(DouyinDownloader, '_extract_info_with_ytdlp')
def test_download_raises_cookie_refresh_biz_exception(mock_ytdlp, mock_fetch):
    mock_fetch.return_value = {
        'aweme_detail': {
            'aweme_id': '7675967406614809865',
            'item_title': 'title',
            'caption': 'caption',
            'video': {
                'duration': 10,
                'cover_original_scale': {'url_list': ['https://example.com/cover.jpg']},
            },
            'video_tag': [],
        }
    }
    mock_ytdlp.side_effect = BizException(
        code=400002,
        message='抖音 Cookie 已失效，请在设置中更新最新浏览器 Cookie 后重试',
    )

    downloader = DouyinDownloader()

    try:
        downloader.download('https://www.douyin.com/video/7675967406614809865', output_dir='/tmp')
        assert False, 'expected BizException'
    except BizException as exc:
        assert exc.code == 400002
        assert 'Cookie 已失效' in exc.message


@patch.object(DouyinDownloader, 'fetch_video_info')
@patch.object(DouyinDownloader, '_extract_info_with_ytdlp')
@patch('app.downloaders.douyin_downloader.subprocess.run')
@patch('app.downloaders.douyin_downloader.requests.get')
def test_download_uses_ytdlp_media_url(mock_get, mock_subprocess, mock_ytdlp, mock_fetch):
    mock_fetch.return_value = {
        'aweme_detail': {
            'aweme_id': '7675967406614809865',
            'item_title': 'title',
            'caption': 'caption',
            'video': {
                'duration': 10,
                'cover_original_scale': {'url_list': ['https://example.com/cover.jpg']},
            },
            'video_tag': [],
        }
    }
    mock_ytdlp.return_value = {
        'id': '7675967406614809865',
        'title': 'title',
        'duration': 10,
        'thumbnail': 'https://example.com/cover.jpg',
        'ext': 'mp4',
        'url': 'https://example.com/video.mp4',
        'http_headers': {'User-Agent': 'ua'},
    }
    response = Mock()
    response.raise_for_status.return_value = None
    response.iter_content.return_value = [b'abc']
    mock_get.return_value = response
    mock_subprocess.return_value = None

    tmpdir = '/tmp'
    media_path = os.path.join(tmpdir, '7675967406614809865.mp4')

    def fake_ffmpeg(cmd, check, stdout, stderr):
        with open(cmd[-1], 'wb') as f:
            f.write(b'mp3')
        return None

    mock_subprocess.side_effect = fake_ffmpeg

    downloader = DouyinDownloader()
    result = downloader.download('https://www.douyin.com/video/7675967406614809865', output_dir=tmpdir)

    assert result.video_id == '7675967406614809865'
    assert result.file_path.endswith('7675967406614809865.mp3')
    assert os.path.exists(media_path)
    mock_get.assert_called_once_with('https://example.com/video.mp4', headers={'User-Agent': 'ua'}, stream=True)


def test_extract_video_id_accepts_modal_id_share_link():
    url = 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection'

    assert extract_video_id(url, 'douyin') == '7660398439615712546'


@patch('app.downloaders.douyin_downloader.requests.head')
def test_downloader_extract_video_id_accepts_modal_id_share_link(mock_head):
    response = Mock()
    response.url = 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection'
    mock_head.return_value = response

    downloader = DouyinDownloader()

    assert downloader.extract_video_id(response.url) == '7660398439615712546'


def test_extract_video_id_accepts_aweme_id_query():
    url = 'https://www.douyin.com/discover?aweme_id=7660398439615712546'

    assert extract_video_id(url, 'douyin') == '7660398439615712546'


def test_extract_video_id_accepts_video_path_with_query_and_fragment():
    url = 'https://www.douyin.com/video/7660398439615712546?previous_page=app_code_link#video'

    assert extract_video_id(url, 'douyin') == '7660398439615712546'


def test_extract_video_id_accepts_share_text_with_modal_id_url():
    text = (
        '6.66 复制打开抖音，看看【作者】的收藏作品 '
        'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection '
        '打开抖音搜索，直接观看视频！'
    )

    assert extract_video_id(text, 'douyin') == '7660398439615712546'


@patch('app.downloaders.douyin_downloader.requests.head')
def test_downloader_extract_video_id_accepts_share_text_with_short_link(mock_head):
    response = Mock()
    response.url = 'https://www.douyin.com/video/7660398439615712546?previous_page=app_code_link#video'
    mock_head.return_value = response

    downloader = DouyinDownloader()
    text = (
        '7.43 11/16 gba:/ j@P.xS 以“马成钢”的视角打开《抓娃娃》笼中鸟，何时飞 '
        '# 独白 # 人物故事 https://v.douyin.com/0pcFVdG_lx4/ '
        '复制此链接，打开Dou音搜索，直接观看视频！'
    )

    assert downloader.extract_video_id(text) == '7660398439615712546'


@patch('app.downloaders.douyin_downloader.requests.head', side_effect=requests.RequestException('boom'))
def test_downloader_extract_video_id_falls_back_to_original_url_when_head_fails(_mock_head):
    downloader = DouyinDownloader()
    url = 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection'

    assert downloader.extract_video_id(url) == '7660398439615712546'


def test_normalize_video_url_converts_modal_id_link_to_video_path():
    downloader = DouyinDownloader()
    url = 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection'

    assert downloader._normalize_video_url(url) == 'https://www.douyin.com/video/7660398439615712546'
