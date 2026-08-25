import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.utils import output_paths


class TestOutputPaths(unittest.TestCase):
    def test_defaults_resolve_to_backend_dir(self):
        app_root = pathlib.Path('/tmp/app-root-example/backend').resolve()
        with patch.object(output_paths, 'APP_ROOT', str(app_root)):
            json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')
            note_dir = output_paths._resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')

        # 历史默认值带 backend/ 前缀，应被剥离后按后端目录解析
        self.assertEqual(json_dir, app_root / 'json_results')
        self.assertEqual(note_dir, app_root / 'note_results')

    def test_relative_env_paths_resolve_from_app_root(self):
        app_root = pathlib.Path('/tmp/app-root-example/backend').resolve()
        with patch.dict(
            'os.environ',
            {
                'JSON_OUTPUT_DIR': 'custom/json',
                'NOTE_OUTPUT_DIR': 'custom/note',
            },
            clear=False,
        ):
            with patch.object(output_paths, 'APP_ROOT', str(app_root)):
                json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')
                note_dir = output_paths._resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')

        self.assertEqual(json_dir, app_root / 'custom' / 'json')
        self.assertEqual(note_dir, app_root / 'custom' / 'note')

    def test_legacy_env_prefix_is_stripped(self):
        app_root = pathlib.Path('/tmp/app-root-example/backend').resolve()
        with patch.dict(
            'os.environ',
            {
                'JSON_OUTPUT_DIR': 'backend/json_results',
                'NOTE_OUTPUT_DIR': './backend/note_results',
            },
            clear=False,
        ):
            with patch.object(output_paths, 'APP_ROOT', str(app_root)):
                json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')
                note_dir = output_paths._resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')

        # 兼容 .env 里的旧写法（仓库根视角），避免出现双层 backend/backend/
        self.assertEqual(json_dir, app_root / 'json_results')
        self.assertEqual(note_dir, app_root / 'note_results')

    def test_absolute_env_path_wins(self):
        absolute = pathlib.Path('/tmp/absolute-output').resolve()
        with patch.dict(
            'os.environ',
            {'JSON_OUTPUT_DIR': str(absolute)},
            clear=False,
        ):
            json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')

        self.assertEqual(json_dir, absolute)


if __name__ == '__main__':
    unittest.main()
