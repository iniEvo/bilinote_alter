import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.routers.artifacts import (  # noqa: E402
    ARTIFACT_REGISTRY_STATIC,
    CleanupRequest,
    _build_registry,
    _clear_globs,
    _clear_item,
    _resolve_glob_files,
    cleanup_artifacts,
    list_artifacts,
)

NOTE_JSON_EXCLUDES = [
    '*_audio.json',
    '*_transcript.json',
    '*.status.json',
    '*.gpt.checkpoint.json',
]


def _mk(tmp, *names):
    for n in names:
        pathlib.Path(tmp, n).write_text('x', encoding='utf-8')


class TestArtifactRegistry(unittest.TestCase):
    def test_note_json_is_not_deletable(self):
        meta = next(m for m in ARTIFACT_REGISTRY_STATIC if m['key'] == 'note_json')
        self.assertFalse(meta['deletable'])
        self.assertTrue(meta['globs'])
        self.assertTrue(meta['exclude_globs'])

    def test_markdown_copy_is_deletable(self):
        meta = next(m for m in _build_registry() if m['key'] == 'markdown_notes')
        self.assertTrue(meta['deletable'])
        self.assertTrue(meta['dirs'])


class TestGlobResolution(unittest.TestCase):
    def test_resolve_glob_files_excludes_intermediates(self):
        with tempfile.TemporaryDirectory() as tmp:
            _mk(tmp, 'a.json', 'b.json', 'a_audio.json', 'a_transcript.json',
                'a.status.json', 'a_markdown.status.json', 'a.gpt.checkpoint.json')
            files = _resolve_glob_files(
                globs=[f'{tmp}/*.json'],
                exclude_globs=[f'{tmp}/{e}' for e in NOTE_JSON_EXCLUDES],
            )
            names = sorted(p.name for p in files)
            # 只保留纯 {task_id}.json，其余中间件全被排除
            self.assertEqual(names, ['a.json', 'b.json'])

    def test_clear_globs_does_not_touch_note_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            _mk(tmp, 'a.json', 'a_audio.json', 'a.status.json')
            # 清理中间件（transcript/state 的 globs 只匹配中间件，不包含 a.json）
            freed, removed = _clear_globs(
                globs=[f'{tmp}/*_audio.json', f'{tmp}/*.status.json'],
                exclude_globs=[],
            )
            self.assertEqual(removed, 2)
            self.assertTrue(pathlib.Path(tmp, 'a.json').exists())  # 笔记 JSON 保留


class TestClearItem(unittest.TestCase):
    def test_clear_item_never_deletes_note_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            _mk(tmp, 'a.json', 'a_audio.json', 'a.status.json')
            # 与中间件条目同构：globs 只匹配中间件，不匹配 a.json
            item = {
                'globs': [f'{tmp}/*_audio.json', f'{tmp}/*.status.json'],
                'exclude_globs': [],
            }
            freed, removed = _clear_item(item)
            self.assertEqual(removed, 2)  # 只删 _audio 与 .status，不删 a.json
            self.assertTrue(pathlib.Path(tmp, 'a.json').exists())


class TestCleanupEndpoint(unittest.TestCase):
    def _body(self, resp):
        return json.loads(resp.body.decode('utf-8'))

    def test_cleanup_refuses_note_json(self):
        resp = cleanup_artifacts(CleanupRequest(keys=['note_json']))
        body = self._body(resp)
        results = body['data']['results']
        self.assertEqual(results[0]['status'], 'refused')

    def test_cleanup_transcript_only_deletes_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            _mk(tmp, 'a.json', 'a_transcript.json')
            note_meta = {'key': 'note_json', 'name': 'x', 'description': 'x',
                         'globs': [f'{tmp}/*.json'],
                         'exclude_globs': [f'{tmp}/{e}' for e in NOTE_JSON_EXCLUDES],
                         'deletable': False, 'warning': None}
            trans_meta = {'key': 'transcript_json', 'name': 'x', 'description': 'x',
                          'globs': [f'{tmp}/*_transcript.json'], 'exclude_globs': [],
                          'deletable': True, 'warning': None}
            registry = [note_meta, trans_meta]
            with patch.object(sys.modules['app.routers.artifacts'], '_build_registry', return_value=registry):
                resp = cleanup_artifacts(CleanupRequest(keys=['transcript_json']))
            body = self._body(resp)
            result = body['data']['results'][0]
            self.assertEqual(result['status'], 'done')
            self.assertEqual(result['removed_files'], 1)
            self.assertTrue(pathlib.Path(tmp, 'a.json').exists())  # 笔记 JSON 不受影响
            self.assertFalse(pathlib.Path(tmp, 'a_transcript.json').exists())


if __name__ == '__main__':
    unittest.main()