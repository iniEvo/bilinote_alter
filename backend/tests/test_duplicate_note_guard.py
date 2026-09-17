import pathlib
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

sys.modules.setdefault('faster_whisper', types.SimpleNamespace(WhisperModel=object))
from starlette.responses import Response

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app import create_app
from app.routers import note as note_router


class _ReadyConfig:
    def is_model_ready(self):
        return {
            'ready': True,
            'reason': '',
            'transcriber_type': 'fast-whisper',
            'model_size': 'tiny',
            'downloading': False,
        }


class TestDuplicateNoteGuard(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        note_router.NOTE_OUTPUT_DIR = self.tmpdir.name
        self.app = create_app(lambda app: None, include_chat=False)
        self.client = TestClient(self.app)

    def tearDown(self):
        note_router._inflight_video_tasks.clear()
        self.tmpdir.cleanup()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._load_note_result', return_value={'markdown': '# existing'})
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_note_requires_confirmation_for_duplicate(self, mock_latest, _mock_result, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='BV13Tbv64E1k',
            platform='bilibili',
            batch_id=None,
            source_url='https://www.bilibili.com/video/BV13Tbv64E1k',
            title=None,
            created_at=None,
        )

        payload = {
            'video_url': 'https://www.bilibili.com/video/BV13Tbv64E1k',
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        response = self.client.post('/api/generate_note', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['code'], 409)
        self.assertEqual(body['data']['reason'], 'duplicate_video_task')
        self.assertEqual(body['data']['duplicate_task']['task_id'], 'existing-task')

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note._find_duplicate_task')
    def test_generate_note_allows_retry_for_failed_duplicate_without_result(self, mock_duplicate, mock_enqueue, _cfg):
        mock_duplicate.return_value = {
            'task_id': 'failed-task',
            'status': 'FAILED',
            'result_exists': False,
            'message': '抖音 Cookie 已失效，请重试',
        }
        mock_enqueue.return_value = Response(
            content='{"code":0,"msg":"success","data":{"task_id":"new-task"}}',
            media_type='application/json',
        )

        payload = {
            'video_url': 'https://www.douyin.com/video/7677293929390169595',
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        response = self.client.post('/api/generate_note', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['code'], 0)
        self.assertEqual(body['data']['task_id'], 'new-task')
        mock_enqueue.assert_called_once()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._load_note_result', return_value={'markdown': '# existing'})
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_notes_batch_skip_duplicates(self, mock_latest, mock_enqueue, _mock_result, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='BV13Tbv64E1k',
            platform='bilibili',
            batch_id=None,
            source_url='https://www.bilibili.com/video/BV13Tbv64E1k',
            title=None,
            created_at=None,
        )

        payload = {
            'video_urls': ['https://www.bilibili.com/video/BV13Tbv64E1k'],
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
            'duplicate_strategy': 'skip',
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['data']['tasks'][0]['skipped'])
        mock_enqueue.assert_not_called()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_notes_batch_continue_confirmed_duplicates(self, mock_latest, mock_enqueue, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='BV13Tbv64E1k',
            platform='bilibili',
            batch_id=None,
            source_url='https://www.bilibili.com/video/BV13Tbv64E1k',
            title=None,
            created_at=None,
        )
        mock_enqueue.return_value = Response(
            content='{"code":200,"msg":"success","data":{"task_id":"new-task"}}',
            media_type='application/json',
        )

        payload = {
            'video_urls': ['https://www.bilibili.com/video/BV13Tbv64E1k'],
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
            'duplicate_strategy': 'confirm',
            'duplicate_confirm_urls': ['https://www.bilibili.com/video/BV13Tbv64E1k'],
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['data']['tasks'][0]['task_id'], 'new-task')
        mock_enqueue.assert_called_once()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_notes_batch_continue_confirmed_duplicates_with_equivalent_douyin_url(self, mock_latest, mock_enqueue, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='7660398439615712546',
            platform='douyin',
            batch_id=None,
            source_url='https://www.douyin.com/video/7660398439615712546',
            title='demo',
            created_at=None,
        )
        mock_enqueue.return_value = Response(
            content='{"code":200,"msg":"success","data":{"task_id":"new-task"}}',
            media_type='application/json',
        )

        payload = {
            'video_urls': ['https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection'],
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
            'duplicate_strategy': 'confirm',
            'duplicate_confirm_urls': ['https://www.douyin.com/video/7660398439615712546'],
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['data']['tasks'][0]['task_id'], 'new-task')
        mock_enqueue.assert_called_once()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.utils.url_parser.resolve_bilibili_short_url', return_value='https://www.bilibili.com/video/BV13Tbv64E1k')
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_notes_batch_continue_confirmed_duplicates_with_equivalent_bilibili_short_url(self, mock_latest, mock_enqueue, _resolve_short_url, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='BV13Tbv64E1k',
            platform='bilibili',
            batch_id=None,
            source_url='https://www.bilibili.com/video/BV13Tbv64E1k',
            title='demo',
            created_at=None,
        )
        mock_enqueue.return_value = Response(
            content='{"code":200,"msg":"success","data":{"task_id":"new-task"}}',
            media_type='application/json',
        )

        payload = {
            'video_urls': ['https://b23.tv/demo'],
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
            'duplicate_strategy': 'confirm',
            'duplicate_confirm_urls': ['https://www.bilibili.com/video/BV13Tbv64E1k'],
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['data']['tasks'][0]['task_id'], 'new-task')
        mock_enqueue.assert_called_once()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_notes_batch_continue_confirmed_duplicates_with_equivalent_youtube_url(self, mock_latest, mock_enqueue, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='dQw4w9WgXcQ',
            platform='youtube',
            batch_id=None,
            source_url='https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title='demo',
            created_at=None,
        )
        mock_enqueue.return_value = Response(
            content='{"code":200,"msg":"success","data":{"task_id":"new-task"}}',
            media_type='application/json',
        )

        payload = {
            'video_urls': ['https://youtu.be/dQw4w9WgXcQ'],
            'platform': 'youtube',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
            'duplicate_strategy': 'confirm',
            'duplicate_confirm_urls': ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['data']['tasks'][0]['task_id'], 'new-task')
        mock_enqueue.assert_called_once()

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._load_note_result', return_value={'markdown': '# existing'})
    @patch('app.routers.note.get_latest_task_record')
    def test_generate_note_duplicate_normalizes_douyin_modal_source_url(self, mock_latest, _mock_result, _cfg):
        mock_latest.return_value = SimpleNamespace(
            task_id='existing-task',
            video_id='7660398439615712546',
            platform='douyin',
            batch_id=None,
            source_url='https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            title='demo',
            created_at=None,
            request_payload_data={
                'video_url': 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            },
        )

        payload = {
            'video_url': 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        response = self.client.post('/api/generate_note', json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        duplicate = body['data']['duplicate_task']
        self.assertEqual(duplicate['source_url'], 'https://www.douyin.com/video/7660398439615712546')
        self.assertEqual(duplicate['request_payload']['video_url'], 'https://www.douyin.com/video/7660398439615712546')

    @patch('app.routers.note.NoteGenerator')
    @patch('app.routers.note.get_latest_task_record', return_value=None)
    @patch('app.routers.note.run_note_task')
    @patch('app.routers.note.insert_video_task', return_value=True)
    def test_enqueue_note_task_normalizes_douyin_modal_source_url(self, mock_insert, _mock_run_task, _mock_latest, mock_note_generator):
        payload = note_router.VideoRequest(
            video_url='https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            platform='douyin',
            quality='fast',
            model_name='deepseek-v4-pro',
            provider_id='provider-1',
            format=[],
            style='minimal',
            grid_size=[2, 2],
        )
        background_tasks = BackgroundTasks()
        background_tasks.add_task = Mock()
        mock_note_generator.return_value._update_status = Mock()

        response = note_router._enqueue_note_task(payload, background_tasks)
        self.assertEqual(response.status_code, 200)
        body = response.body and __import__('json').loads(response.body.decode('utf-8'))
        inserted_payload = mock_insert.call_args.kwargs['request_payload']
        self.assertEqual(mock_insert.call_args.kwargs['source_url'], 'https://www.douyin.com/video/7660398439615712546')
        self.assertEqual(inserted_payload['video_url'], 'https://www.douyin.com/video/7660398439615712546')
        self.assertEqual(note_router._inflight_video_tasks[('douyin', '7660398439615712546')], body['data']['task_id'])

    @patch('app.routers.note.get_latest_task_record', return_value=None)
    @patch('app.routers.note.insert_video_task', return_value=False)
    def test_enqueue_note_task_returns_error_when_task_persistence_fails(self, mock_insert, _mock_latest):
        payload = note_router.VideoRequest(
            video_url='https://www.douyin.com/video/7660398439615712546',
            platform='douyin',
            quality='fast',
            model_name='deepseek-v4-pro',
            provider_id='provider-1',
            format=[],
            style='minimal',
            grid_size=[2, 2],
        )
        background_tasks = BackgroundTasks()
        background_tasks.add_task = Mock()

        response = note_router._enqueue_note_task(payload, background_tasks)
        body = response.body and __import__('json').loads(response.body.decode('utf-8'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['code'], 500)
        self.assertEqual(body['data']['reason'], 'task_persistence_failed')
        self.assertNotIn(('douyin', '7660398439615712546'), note_router._inflight_video_tasks)
        background_tasks.add_task.assert_not_called()
        mock_insert.assert_called_once()

    def test_history_task_returns_canonical_douyin_source_url(self):
        task_id = 'history-task'
        row = SimpleNamespace(
            task_id=task_id,
            video_id='7660398439615712546',
            platform='douyin',
            batch_id=None,
            batch_name=None,
            source_url='https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            title='demo',
            created_at=None,
            request_payload_data={
                'video_url': 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            },
        )

        with patch('app.routers.note.get_task_record', return_value=row):
            response = self.client.get(f'/api/history/{task_id}')

        self.assertEqual(response.status_code, 200)
        item = response.json()['data']
        self.assertEqual(item['source_url'], 'https://www.douyin.com/video/7660398439615712546')
        self.assertEqual(item['request_payload']['video_url'], 'https://www.douyin.com/video/7660398439615712546')


if __name__ == '__main__':
    unittest.main()
