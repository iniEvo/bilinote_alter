import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.downloaders import local_downloader


class TestResolveLocalVideoUrl(unittest.TestCase):
    def _patch_app_root(self, app_root: pathlib.Path):
        return patch.object(
            local_downloader,
            'resolve_app_path',
            lambda p: str(app_root / str(p)),
        )

    def test_uploads_url_resolves_to_single_uploads_dir(self):
        # URL 前缀 /uploads/ 应被剥掉后再拼上传目录，避免出现 uploads/uploads/
        app_root = pathlib.Path('/tmp/app-root-example/backend')
        with self._patch_app_root(app_root):
            resolved = local_downloader._resolve_local_video_url('/uploads/场照后期.mp4')

        self.assertEqual(resolved, str(app_root / 'uploads' / '场照后期.mp4'))

    def test_nested_filename_keeps_subpath(self):
        app_root = pathlib.Path('/tmp/app-root-example/backend')
        with self._patch_app_root(app_root):
            resolved = local_downloader._resolve_local_video_url('/uploads/sub/dir/a.mp4')

        self.assertEqual(resolved, str(app_root / 'uploads' / 'sub' / 'dir' / 'a.mp4'))

    def test_absolute_path_passthrough(self):
        absolute_path = '/Users/someone/movies/a.mp4'
        self.assertEqual(local_downloader._resolve_local_video_url(absolute_path), absolute_path)

    def test_http_url_passthrough(self):
        url = 'https://example.com/uploads/a.mp4'
        self.assertEqual(local_downloader._resolve_local_video_url(url), url)

    def test_similar_prefix_not_matched(self):
        # /uploadsfoo 不是 /uploads 静态目录，应原样返回而不是误拼
        weird = '/uploadsfoo/a.mp4'
        self.assertEqual(local_downloader._resolve_local_video_url(weird), weird)


if __name__ == '__main__':
    unittest.main()
