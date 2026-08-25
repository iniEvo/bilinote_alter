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
    def test_relative_defaults_resolve_from_workspace_root(self):
        workspace = pathlib.Path('/tmp/workspace-root-example').resolve()
        with patch.object(output_paths, '_WORKSPACE_ROOT', workspace):
            json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')
            note_dir = output_paths._resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')

        self.assertEqual(json_dir, workspace / 'backend' / 'json_results')
        self.assertEqual(note_dir, workspace / 'backend' / 'note_results')

    def test_relative_env_paths_resolve_from_workspace_root(self):
        workspace = pathlib.Path('/tmp/workspace-root-example').resolve()
        with patch.dict(
            'os.environ',
            {
                'JSON_OUTPUT_DIR': 'custom/json',
                'NOTE_OUTPUT_DIR': 'custom/note',
            },
            clear=False,
        ):
            with patch.object(output_paths, '_WORKSPACE_ROOT', workspace):
                json_dir = output_paths._resolve_output_dir('JSON_OUTPUT_DIR', 'backend/json_results')
                note_dir = output_paths._resolve_output_dir('NOTE_OUTPUT_DIR', 'backend/note_results')

        self.assertEqual(json_dir, workspace / 'custom' / 'json')
        self.assertEqual(note_dir, workspace / 'custom' / 'note')


if __name__ == '__main__':
    unittest.main()
