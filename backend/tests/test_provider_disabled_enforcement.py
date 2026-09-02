"""验证模型供应商「关闭(enabled=0)」后的全链路拦截（issue：关闭供应商后仍可使用已关闭模型）。

覆盖四层：
1. 服务层 `NoteGenerator._get_gpt()` 对 disabled 供应商抛 ProviderError(PROVIDER_DISABLED)
2. 路由层 `_validate_provider_enabled()` 同步前置校验，返回 reason=provider_disabled + available_models
3. 路由层 `_validate_model_override()` 拒绝把覆盖目标指向已关闭供应商
4. 路由层 `_build_retry_request()` 复用旧配置时，把已关闭供应商标为 provider_disabled 跳过原因
5. `chat_service.chat()` 对 disabled 供应商抛 ValueError
"""
import pathlib
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

sys.modules.setdefault('faster_whisper', types.SimpleNamespace(WhisperModel=object))

from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app import create_app  # noqa: E402
from app.routers import note as note_router  # noqa: E402
from app.services.provider import ProviderService  # noqa: E402
from app.services.note import NoteGenerator  # noqa: E402
from app.exceptions.provider import ProviderError  # noqa: E402
from app.enmus.exception import ProviderErrorEnum  # noqa: E402


class _ReadyConfig:
    def is_model_ready(self):
        return {
            'ready': True,
            'reason': '',
            'transcriber_type': 'fast-whisper',
            'model_size': 'tiny',
            'downloading': False,
        }


class TestProviderDisabledEnforcement(unittest.TestCase):
    def setUp(self):
        self.app = create_app(lambda app: None, include_chat=False)
        self.client = TestClient(self.app)

    def tearDown(self):
        note_router._inflight_video_tasks.clear()

    # ---- 1. 服务层 _get_gpt 拦截 ----

    @patch.object(ProviderService, 'get_provider_by_id')
    def test_get_gpt_raises_on_disabled_provider(self, mock_get):
        mock_get.return_value = {
            'id': 'p1', 'name': 'DeepSeek', 'type': 'custom',
            'api_key': 'k', 'base_url': 'https://x', 'enabled': 0,
        }
        with self.assertRaises(ProviderError) as ctx:
            NoteGenerator()._get_gpt('deepseek-chat', 'p1')
        self.assertEqual(ctx.exception.code, ProviderErrorEnum.PROVIDER_DISABLED)
        self.assertIn('已关闭', str(ctx.exception.message))

    @patch.object(ProviderService, 'get_provider_by_id')
    def test_get_gpt_allows_enabled_provider(self, mock_get):
        mock_get.return_value = {
            'id': 'p1', 'name': 'DeepSeek', 'type': 'custom',
            'api_key': 'k', 'base_url': 'https://x', 'enabled': 1,
        }
        # enabled 供应商不抛 ProviderError（后续构建 GPT 实例会因缺少真实 SDK 而抛其他错误，
        # 但不应是 PROVIDER_DISABLED）
        try:
            NoteGenerator()._get_gpt('deepseek-chat', 'p1')
        except ProviderError as e:
            self.assertNotEqual(e.code, ProviderErrorEnum.PROVIDER_DISABLED)

    # ---- 2. 路由层 _validate_provider_enabled ----

    @patch.object(ProviderService, 'get_provider_by_id')
    def test_validate_provider_enabled_returns_none_for_enabled(self, mock_get):
        mock_get.return_value = {'id': 'p1', 'name': 'DeepSeek', 'enabled': 1}
        self.assertIsNone(note_router._validate_provider_enabled('p1'))

    @patch.object(ProviderService, 'get_provider_by_id')
    @patch('app.services.model.ModelService.get_all_models', return_value=[
        {'id': 2, 'provider_id': 'p2', 'model_name': 'gpt-4o-mini'},
    ])
    def test_validate_provider_enabled_returns_error_for_disabled(self, mock_models, mock_get):
        mock_get.return_value = {'id': 'p1', 'name': 'DeepSeek', 'enabled': 0}
        resp = note_router._validate_provider_enabled('p1')
        body = resp.body and __import__('json').loads(resp.body.decode('utf-8'))
        self.assertEqual(body['code'], ProviderErrorEnum.PROVIDER_DISABLED.code)
        self.assertEqual(body['data']['reason'], 'provider_disabled')
        self.assertEqual(body['data']['provider_name'], 'DeepSeek')
        self.assertEqual(body['data']['available_models'][0]['model_name'], 'gpt-4o-mini')

    # ---- 3. 路由层 _validate_model_override ----

    @patch.object(ProviderService, 'get_provider_by_id')
    def test_validate_model_override_rejects_disabled_provider(self, mock_get):
        mock_get.return_value = {'id': 'p1', 'name': 'DeepSeek', 'enabled': 0}
        err = note_router._validate_model_override('p1', 'deepseek-chat')
        self.assertIn('已关闭', err)

    # ---- 4. 路由层 _build_retry_request ----

    def test_build_retry_request_marks_disabled_provider(self):
        item = {
            'request_payload': {
                'video_url': 'https://www.bilibili.com/video/BV1xx',
                'model_name': 'deepseek-chat',
                'provider_id': 'p1',
                'quality': 'fast',
            },
            'platform': 'bilibili',
            'source_url': 'https://www.bilibili.com/video/BV1xx',
        }
        row = SimpleNamespace(task_id='t1', platform='bilibili')
        with patch.object(ProviderService, 'get_provider_by_id', return_value={
            'id': 'p1', 'name': 'DeepSeek', 'enabled': 0,
        }):
            req, url, reason = note_router._build_retry_request(item, row)
        self.assertIsNone(req)
        self.assertTrue(reason.startswith('provider_disabled:DeepSeek'))

    def test_build_retry_request_allows_enabled_provider(self):
        item = {
            'request_payload': {
                'video_url': 'https://www.bilibili.com/video/BV1xx',
                'model_name': 'deepseek-chat',
                'provider_id': 'p1',
                'quality': 'fast',
            },
            'platform': 'bilibili',
            'source_url': 'https://www.bilibili.com/video/BV1xx',
        }
        row = SimpleNamespace(task_id='t1', platform='bilibili')
        with patch.object(ProviderService, 'get_provider_by_id', return_value={
            'id': 'p1', 'name': 'DeepSeek', 'enabled': 1,
        }):
            req, url, reason = note_router._build_retry_request(item, row)
        self.assertIsNotNone(req)
        self.assertIsNone(reason)
        self.assertEqual(req.provider_id, 'p1')

    # ---- 5. chat_service 拦截（RAG 对话） ----

    @patch.object(ProviderService, 'get_provider_by_id')
    def test_chat_raises_on_disabled_provider(self, mock_get):
        # chat_service 顶部 `from app.services.vector_store import VectorStoreManager` 会拉入
        # chromadb / path_helper 等重依赖；全量跑时这些模块可能被其他测试替换成 stub。
        # 这里先 stub vector_store 再导入 chat_service，隔离重依赖，只测 provider 校验逻辑。
        vs_stub = types.ModuleType('app.services.vector_store')
        vs_stub.VectorStoreManager = Mock(return_value=Mock(query=Mock(return_value=[])))
        sys.modules['app.services.vector_store'] = vs_stub
        try:
            from app.services import chat_service
        finally:
            sys.modules.pop('app.services.vector_store', None)

        mock_get.return_value = {
            'id': 'p1', 'name': 'DeepSeek', 'type': 'custom',
            'api_key': 'k', 'base_url': 'https://x', 'enabled': 0,
        }
        with self.assertRaises(ValueError) as ctx:
            chat_service.chat('t1', 'hi', [], 'p1', 'deepseek-chat')
        self.assertIn('已关闭', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()