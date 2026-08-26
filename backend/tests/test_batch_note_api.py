import pathlib
import sys
import tempfile
import types
import unittest
from dataclasses import dataclass, field
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.modules.setdefault('faster_whisper', types.SimpleNamespace(WhisperModel=object))

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


@dataclass
class _FakeAudioMeta:
    title: str = 'demo'


@dataclass
class _FakeNote:
    markdown: str
    audio_meta: _FakeAudioMeta = field(default_factory=_FakeAudioMeta)


class TestBatchNoteApi(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        note_router.NOTE_OUTPUT_DIR = self.tmpdir.name
        output_dir = pathlib.Path(self.tmpdir.name)
        note_router.task_status_path = lambda task_id: output_dir / f'{task_id}.status.json'
        note_router.note_json_path = lambda task_id: output_dir / f'{task_id}.json'
        note_router.audio_json_path = lambda task_id: output_dir / f'{task_id}_audio.json'
        note_router.transcript_json_path = lambda task_id: output_dir / f'{task_id}_transcript.json'
        note_router.markdown_status_path = lambda task_id: output_dir / f'{task_id}_markdown.status.json'
        note_router.note_markdown_path = lambda task_id, title=None: output_dir / f'{task_id}_markdown.md'
        self.app = create_app(lambda app: None, include_chat=False)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.tmpdir.cleanup()

    @patch('app.routers.note.insert_video_task')
    @patch('app.routers.note.NoteGenerator')
    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    def test_batch_generate_returns_batch_id_and_tasks(self, _cfg, mock_note_generator, mock_insert):
        mock_note_generator.return_value._update_status.return_value = None
        mock_note_generator.return_value.generate.return_value = _FakeNote(markdown='ok')

        payload = {
            'video_urls': [
                'https://www.bilibili.com/video/BV13Tbv64E1k',
                'https://www.bilibili.com/video/BV13Tbv64E1k',
            ],
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertIn('batch_id', data)
        self.assertEqual(len(data['tasks']), 1)
        self.assertEqual(data['tasks'][0]['batch_id'], data['batch_id'])
        self.assertEqual(mock_insert.call_count, 1)

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    @patch('app.utils.url_parser.resolve_bilibili_short_url', return_value='https://www.bilibili.com/video/BV13Tbv64E1k')
    def test_batch_collapses_equivalent_bilibili_urls_by_video_identity(self, _resolve_short_url, mock_enqueue, _cfg):
        mock_enqueue.return_value = note_router.R.success({'task_id': 'task-1'})
        payload = {
            'video_urls': [
                'https://www.bilibili.com/video/BV13Tbv64E1k',
                'https://b23.tv/demo',
            ],
            'platform': 'bilibili',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        with patch('app.routers.note.get_latest_task_record', return_value=None):
            response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(len(data['tasks']), 1)
        self.assertEqual(mock_enqueue.call_count, 1)
        self.assertEqual(data['tasks'][0]['video_url'], 'https://www.bilibili.com/video/BV13Tbv64E1k')

    @patch('app.services.transcriber_config_manager.TranscriberConfigManager', return_value=_ReadyConfig())
    @patch('app.routers.note._enqueue_note_task')
    def test_batch_collapses_equivalent_douyin_urls_by_video_identity(self, mock_enqueue, _cfg):
        mock_enqueue.return_value = note_router.R.success({'task_id': 'task-1'})
        payload = {
            'video_urls': [
                'https://www.douyin.com/video/7660398439615712546',
                'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7660398439615712546&showTab=favorite_collection',
            ],
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        with patch('app.routers.note.get_latest_task_record', return_value=None):
            response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(len(data['tasks']), 1)
        self.assertEqual(mock_enqueue.call_count, 1)
        self.assertEqual(data['tasks'][0]['video_url'], 'https://www.douyin.com/video/7660398439615712546')

    def test_batch_accepts_douyin_urls_with_trailing_query(self):
        payload = {
            'video_urls': [
                'https://www.douyin.com/video/7674902822596463891?previous_page=app_code_link',
            ],
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        with patch('app.routers.note._enqueue_note_task') as mock_enqueue, patch(
            'app.routers.note.get_latest_task_record', return_value=None
        ):
            mock_enqueue.return_value = note_router.R.success({'task_id': 'task-1'})
            response = self.client.post('/api/generate_notes_batch', json=payload)
        self.assertEqual(response.status_code, 200)
        tasks = response.json()['data']['tasks']
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]['video_url'], payload['video_urls'][0])
        self.assertEqual(tasks[0]['code'], 0)
        self.assertEqual(tasks[0]['msg'], 'success')
        self.assertEqual(mock_enqueue.call_count, 1)

    def test_single_generate_note_allows_empty_video_url_for_batch_payload(self):
        payload = {
            'video_url': '',
            'platform': 'douyin',
            'quality': 'fast',
            'model_name': 'deepseek-v4-pro',
            'provider_id': 'provider-1',
            'format': [],
            'style': 'minimal',
            'grid_size': [2, 2],
        }
        with patch('app.routers.note._enqueue_note_task') as mock_enqueue:
            mock_enqueue.return_value = note_router.R.success({'task_id': 'task-empty'})
            response = self.client.post('/api/generate_note', json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['task_id'], 'task-empty')
        self.assertEqual(mock_enqueue.call_count, 1)

    def test_batch_status_summarizes_items(self):
        batch_id = 'batch-1'
        ok_task = 'task-ok'
        fail_task = 'task-fail'
        pending_task = 'task-pending'

        pathlib.Path(self.tmpdir.name, f'{ok_task}.status.json').write_text('{"status": "SUCCESS"}', encoding='utf-8')
        pathlib.Path(self.tmpdir.name, f'{ok_task}.json').write_text('{"markdown": "ok"}', encoding='utf-8')
        pathlib.Path(self.tmpdir.name, f'{fail_task}.status.json').write_text('{"status": "FAILED", "message": "boom"}', encoding='utf-8')
        pathlib.Path(self.tmpdir.name, f'{pending_task}.status.json').write_text('{"status": "DOWNLOADING"}', encoding='utf-8')

        row = lambda task_id, video_id: type(
            'Row',
            (),
            {
                'task_id': task_id,
                'video_id': video_id,
                'platform': 'bilibili',
                'batch_id': batch_id,
                'source_url': f'https://example.com/{video_id}',
                'title': None,
                'created_at': None,
            },
        )()

        with patch('app.routers.note.list_tasks_by_batch', return_value=[
            row(ok_task, 'BV1'),
            row(fail_task, 'BV2'),
            row(pending_task, 'BV3'),
        ]):
            response = self.client.get(f'/api/batch_status/{batch_id}')

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['summary']['total'], 3)
        self.assertEqual(data['summary']['success'], 1)
        self.assertEqual(data['summary']['failed'], 1)
        self.assertEqual(data['summary']['pending'], 1)
        self.assertEqual(len(data['items']), 3)

    def test_task_status_prefers_result_when_status_file_stalls(self):
        task_id = 'task-stalled'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "TRANSCRIBING"}',
            encoding='utf-8',
        )
        pathlib.Path(self.tmpdir.name, f'{task_id}.json').write_text(
            '{"markdown": "ok"}',
            encoding='utf-8',
        )

        response = self.client.get(f'/api/task_status/{task_id}')
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['status'], 'SUCCESS')
        self.assertEqual(data['result']['markdown'], 'ok')

    def test_task_status_returns_not_found_without_row_or_status_file(self):
        response = self.client.get('/api/task_status/missing-task')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['code'], 404)
        self.assertEqual(body['msg'], '任务不存在')

    def test_recent_task_item_prefers_result_when_status_file_stalls(self):
        task_id = 'task-stalled-list'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "TRANSCRIBING"}',
            encoding='utf-8',
        )
        pathlib.Path(self.tmpdir.name, f'{task_id}.json').write_text(
            '{"markdown": "ok"}',
            encoding='utf-8',
        )

        row = SimpleNamespace(
            task_id=task_id,
            video_id='7674902822596463891',
            platform='douyin',
            batch_id='batch-1',
            batch_name='20250101010101',
            source_url='https://www.douyin.com/video/7674902822596463891',
            title='demo',
            created_at=None,
            request_payload_data={},
        )

        item = note_router._build_task_item(task_id, row=row)
        self.assertEqual(item['status'], 'SUCCESS')
        self.assertEqual(item['result']['markdown'], 'ok')

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_recovers_legacy_rows_without_request_payload(self, mock_enqueue):
        batch_id = 'legacy-batch'
        task_id = 'legacy-task'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id='7674902822596463891',
            platform='douyin',
            batch_id=batch_id,
            batch_name=None,
            source_url='https://www.douyin.com/video/7674902822596463891',
            title=None,
            created_at=None,
            request_payload_data={},
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.services.model.ModelService.get_all_models',
            return_value=[{'provider_id': 'provider-1', 'model_name': 'deepseek-v4-pro'}],
        ), patch('app.routers.note._load_task_status', return_value=('FAILED', 'boom')):
            response = self.client.post('/api/batch_retry_failed', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        mock_enqueue.assert_called_once()
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.video_url, row.source_url)
        self.assertEqual(retry_request.model_name, 'deepseek-v4-pro')
        self.assertEqual(retry_request.provider_id, 'provider-1')

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_targets_single_task_when_task_id_provided(self, mock_enqueue):
        batch_id = 'batch-single-retry'
        retried_task = 'task-retried'
        untouched_task = 'task-untouched'
        pathlib.Path(self.tmpdir.name, f'{retried_task}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        pathlib.Path(self.tmpdir.name, f'{untouched_task}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': retried_task, 'batch_id': batch_id})

        def row(task_id, video_id):
            return SimpleNamespace(
                task_id=task_id,
                video_id=video_id,
                platform='douyin',
                batch_id=batch_id,
                batch_name='20250101010101',
                source_url=f'https://www.douyin.com/video/{video_id}',
                title=None,
                created_at=None,
                request_payload_data={},
            )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[
            row(retried_task, '7674902822596463891'),
            row(untouched_task, '7674902822596463892'),
        ]), patch(
            'app.services.model.ModelService.get_all_models',
            return_value=[{'provider_id': 'provider-1', 'model_name': 'deepseek-v4-pro'}],
        ), patch('app.routers.note._load_task_status', return_value=('FAILED', 'boom')):
            response = self.client.post('/api/batch_retry_failed', json={'batch_id': batch_id, 'task_id': retried_task})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['retried'][0]['task_id'], retried_task)
        mock_enqueue.assert_called_once()
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.task_id, retried_task)
        self.assertEqual(retry_request.video_url, 'https://www.douyin.com/video/7674902822596463891')

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_canonicalizes_douyin_modal_id_url(self, mock_enqueue):
        batch_id = 'batch-modal-retry'
        task_id = 'task-modal-retry'
        modal_url = (
            'https://www.douyin.com/user/self?from_tab_name=main&'
            'modal_id=7660398439615712546&showTab=favorite_collection'
        )
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id='7660398439615712546',
            platform='douyin',
            batch_id=batch_id,
            batch_name='20250101010101',
            source_url=modal_url,
            title=None,
            created_at=None,
            request_payload_data={
                'video_url': modal_url,
                'platform': 'douyin',
                'quality': 'fast',
                'model_name': 'deepseek-v4-pro',
                'provider_id': 'provider-1',
                'format': ['toc'],
                'style': 'tutorial',
                'grid_size': [2, 2],
            },
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.routers.note._load_task_status', return_value=('FAILED', 'boom')
        ):
            response = self.client.post('/api/batch_retry_failed', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        mock_enqueue.assert_called_once()
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.task_id, task_id)
        self.assertEqual(retry_request.video_url, 'https://www.douyin.com/video/7660398439615712546')

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_reuses_task_id_when_payload_has_null_task_id(self, mock_enqueue):
        # 历史批量首次提交会在 request_payload 里残留 task_id=null，重试时必须
        # 用数据库行主键覆盖它，否则会被当成新任务插入新行（回归保护）。
        batch_id = 'batch-null-task-id'
        task_id = 'task-null-task-id'
        video_id = '7674902822596463891'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id=video_id,
            platform='douyin',
            batch_id=batch_id,
            batch_name='20250101010101',
            source_url=f'https://www.douyin.com/video/{video_id}',
            title=None,
            created_at=None,
            request_payload_data={
                'task_id': None,
                'video_url': f'https://www.douyin.com/video/{video_id}',
                'platform': 'douyin',
                'quality': 'fast',
                'model_name': 'deepseek-v4-pro',
                'provider_id': 'provider-1',
                'format': ['toc'],
                'style': 'tutorial',
                'grid_size': [2, 2],
            },
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.routers.note._load_task_status', return_value=('FAILED', 'boom')
        ):
            response = self.client.post('/api/batch_retry_failed', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        mock_enqueue.assert_called_once()
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.task_id, task_id)

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_with_model_override(self, mock_enqueue):
        # 覆盖模型：重试应使用请求指定的 provider/model，而不是旧 payload 里的
        batch_id = 'batch-override'
        task_id = 'task-override'
        video_id = '7674902822596463891'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id=video_id,
            platform='douyin',
            batch_id=batch_id,
            batch_name='20250101010101',
            source_url=f'https://www.douyin.com/video/{video_id}',
            title=None,
            created_at=None,
            request_payload_data={
                'task_id': None,
                'video_url': f'https://www.douyin.com/video/{video_id}',
                'platform': 'douyin',
                'quality': 'fast',
                'model_name': 'old-model',
                'provider_id': 'old-provider',
                'format': ['toc'],
                'style': 'tutorial',
                'grid_size': [2, 2],
            },
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.routers.note._load_task_status', return_value=('FAILED', 'boom')
        ), patch(
            'app.services.provider.ProviderService.get_provider_by_id',
            return_value={'id': 'new-provider', 'name': 'New'},
        ), patch(
            'app.db.model_dao.get_model_by_provider_and_name',
            return_value={'id': 1, 'provider_id': 'new-provider', 'model_name': 'new-model'},
        ):
            response = self.client.post('/api/batch_retry_failed', json={
                'batch_id': batch_id,
                'provider_id': 'new-provider',
                'model_name': 'new-model',
            })

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.provider_id, 'new-provider')
        self.assertEqual(retry_request.model_name, 'new-model')
        self.assertEqual(retry_request.task_id, task_id)

    def test_batch_retry_failed_rejects_partial_override(self):
        batch_id = 'batch-partial-override'
        response = self.client.post('/api/batch_retry_failed', json={
            'batch_id': batch_id,
            'provider_id': 'new-provider',
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotEqual(body['code'], 0)
        self.assertIn('同时提供', body['msg'])

    def test_batch_retry_failed_rejects_unknown_provider_model(self):
        with patch(
            'app.services.provider.ProviderService.get_provider_by_id',
            return_value={'id': 'ghost-provider', 'name': 'Ghost'},
        ), patch(
            'app.db.model_dao.get_model_by_provider_and_name',
            return_value=None,
        ):
            response = self.client.post('/api/batch_retry_failed', json={
                'batch_id': 'batch-unknown-override',
                'provider_id': 'ghost-provider',
                'model_name': 'nope-model',
            })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotEqual(body['code'], 0)
        self.assertIn('不存在', body['msg'])

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_retry_failed_allows_transcript_only_tasks_without_video_url(self, mock_enqueue):
        batch_id = 'batch-transcript-only'
        task_id = 'task-transcript-only'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "FAILED", "message": "boom"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id='transcript-only',
            platform='douyin',
            batch_id=batch_id,
            batch_name='20250101010101',
            source_url='',
            title=None,
            created_at=None,
            request_payload_data={
                'video_url': '',
                'platform': 'douyin',
                'quality': 'fast',
                'model_name': 'deepseek-v4-pro',
                'provider_id': 'provider-1',
                'format': [],
                'style': 'minimal',
                'grid_size': [2, 2],
                'prefetched_transcript': {
                    'full_text': 'hello',
                    'segments': [{'start': 0, 'end': 1, 'text': 'hello'}],
                },
            },
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.routers.note._load_task_status', return_value=('FAILED', 'boom')
        ):
            response = self.client.post('/api/batch_retry_failed', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['retried'][0]['task_id'], task_id)
        mock_enqueue.assert_called_once()
        retry_request = mock_enqueue.call_args.args[0]
        self.assertEqual(retry_request.task_id, task_id)
        self.assertEqual(retry_request.video_url, 'https://www.douyin.com/video/transcript-only')
        self.assertIsNotNone(retry_request.prefetched_transcript)

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_resume_allows_transcript_only_tasks_without_video_url(self, mock_enqueue):
        batch_id = 'batch-resume-transcript-only'
        task_id = 'task-resume-transcript-only'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "PAUSED", "message": "hold"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id='transcript-only',
            platform='douyin',
            batch_id=batch_id,
            batch_name='20250101010101',
            source_url='',
            title=None,
            created_at=None,
            request_payload_data={
                'video_url': '',
                'platform': 'douyin',
                'quality': 'fast',
                'model_name': 'deepseek-v4-pro',
                'provider_id': 'provider-1',
                'format': [],
                'style': 'minimal',
                'grid_size': [2, 2],
                'prefetched_transcript': {
                    'full_text': 'hello',
                    'segments': [{'start': 0, 'end': 1, 'text': 'hello'}],
                },
            },
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.routers.note._load_task_status', return_value=('PAUSED', 'hold')
        ):
            response = self.client.post('/api/batch_resume', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['resumed'][0]['task_id'], task_id)
        mock_enqueue.assert_called_once()
        resume_request = mock_enqueue.call_args.args[0]
        self.assertEqual(resume_request.task_id, task_id)
        self.assertEqual(resume_request.video_url, 'https://www.douyin.com/video/transcript-only')
        self.assertIsNotNone(resume_request.prefetched_transcript)

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_resume_can_include_pending_with_limit(self, mock_enqueue):
        batch_id = 'batch-pending-resume'
        task_a = 'task-pending-a'
        task_b = 'task-pending-b'
        task_c = 'task-paused-c'
        mock_enqueue.return_value = note_router.R.success({'task_id': task_a, 'batch_id': batch_id})

        def row(task_id, video_id):
            return SimpleNamespace(
                task_id=task_id,
                video_id=video_id,
                platform='douyin',
                batch_id=batch_id,
                batch_name='20250101010101',
                source_url=f'https://www.douyin.com/video/{video_id}',
                title=None,
                created_at=None,
                request_payload_data={},
            )

        rows = [
            row(task_a, '7674902822596463891'),
            row(task_b, '7674550360672849202'),
            row(task_c, '7674505734155013419'),
        ]

        def fake_status(task_id, **_kwargs):
            mapping = {
                task_a: ('PENDING', ''),
                task_b: ('PENDING', ''),
                task_c: ('PAUSED', 'hold'),
            }
            return mapping[task_id]

        with patch('app.routers.note.list_tasks_by_batch', return_value=rows), patch(
            'app.services.model.ModelService.get_all_models',
            return_value=[{'provider_id': 'provider-1', 'model_name': 'deepseek-v4-pro'}],
        ), patch('app.routers.note._load_task_status', side_effect=fake_status):
            response = self.client.post(
                '/api/batch_resume',
                json={'batch_id': batch_id, 'include_pending': True, 'limit': 2},
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['resumed']), 2)
        self.assertEqual(mock_enqueue.call_count, 2)
        resumed_task_ids = [item['task_id'] for item in data['resumed']]
        self.assertEqual(resumed_task_ids, [task_a, task_b])

    @patch('app.routers.note._enqueue_note_task')
    def test_batch_resume_recovers_legacy_rows_without_request_payload(self, mock_enqueue):
        batch_id = 'legacy-resume-batch'
        task_id = 'legacy-resume-task'
        pathlib.Path(self.tmpdir.name, f'{task_id}.status.json').write_text(
            '{"status": "PAUSED", "message": "hold"}',
            encoding='utf-8',
        )
        mock_enqueue.return_value = note_router.R.success({'task_id': task_id, 'batch_id': batch_id})

        row = SimpleNamespace(
            task_id=task_id,
            video_id='7674902822596463891',
            platform='douyin',
            batch_id=batch_id,
            batch_name=None,
            source_url='https://www.douyin.com/video/7674902822596463891',
            title=None,
            created_at=None,
            request_payload_data={},
        )

        with patch('app.routers.note.list_tasks_by_batch', return_value=[row]), patch(
            'app.services.model.ModelService.get_all_models',
            return_value=[{'provider_id': 'provider-1', 'model_name': 'deepseek-v4-pro'}],
        ), patch('app.routers.note._load_task_status', return_value=('PAUSED', 'hold')):
            response = self.client.post('/api/batch_resume', json={'batch_id': batch_id})

        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['count'], 1)
        mock_enqueue.assert_called_once()
        resume_request = mock_enqueue.call_args.args[0]
        self.assertEqual(resume_request.video_url, row.source_url)
        self.assertEqual(resume_request.model_name, 'deepseek-v4-pro')
        self.assertEqual(resume_request.provider_id, 'provider-1')


class TestNoteGeneratorEmptyTranscript(unittest.TestCase):
    @patch.object(note_router.NoteGenerator, '_init_transcriber', return_value=object())
    def test_generate_fails_gracefully_when_transcript_is_empty(self, _mock_init_transcriber):
        note_generator = note_router.NoteGenerator()
        fake_audio = SimpleNamespace(
            file_path='demo.mp3',
            title='demo',
            video_id='video-1',
        )
        empty_transcript = SimpleNamespace(full_text='', segments=[])

        with patch.object(note_generator, '_get_downloader'), patch.object(note_generator, '_get_gpt'), patch.object(
            note_generator,
            '_download_media',
            return_value=fake_audio,
        ), patch.object(note_generator, '_get_transcript', return_value=empty_transcript), patch.object(
            note_generator,
            '_update_status',
        ) as mock_status:
            result = note_generator.generate(
                video_url='https://www.douyin.com/video/7649010687059491003',
                platform='douyin',
                quality='fast',
                task_id='task-empty-transcript',
                model_name='deepseek-v4-pro',
                provider_id='provider-1',
            )

        self.assertIsNone(result)
        final_status = mock_status.call_args_list[-1].args[1]
        final_message = mock_status.call_args_list[-1].kwargs.get('message')
        self.assertEqual(final_status, note_router.TaskStatus.FAILED)
        self.assertEqual(final_message, '转写结果为空，无法生成笔记')


if __name__ == '__main__':
    unittest.main()
