"""测试瞬时错误（可重试）与永久失败（不可重试）的分类逻辑。

覆盖 app.services.note._is_retryable_error：
- Broken pipe / ConnectionReset 等瞬时网络错误 → 可重试
- 403 反爬、欠费（402）、业务错误 → 永久失败（不可重试）
"""
import errno
import importlib.util
import pathlib
import socket
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "app" / "services" / "note.py"

# 用 importlib 单独加载模块，避免触发 app.services.note 顶层依赖的完整初始化
spec = importlib.util.spec_from_file_location("note_service_under_test", MODULE_PATH)
if spec is None or spec.loader is None:
    raise ImportError("note service module spec not found")
note_service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(note_service)


class TestRetryableClassification(unittest.TestCase):
    def test_broken_pipe_error_is_retryable(self):
        self.assertTrue(note_service._is_retryable_error(BrokenPipeError("Broken pipe")))

    def test_connection_reset_error_is_retryable(self):
        self.assertTrue(note_service._is_retryable_error(ConnectionResetError("Connection reset by peer")))

    def test_connection_aborted_error_is_retryable(self):
        self.assertTrue(note_service._is_retryable_error(ConnectionAbortedError("Connection aborted")))

    def test_timeout_error_is_retryable(self):
        self.assertTrue(note_service._is_retryable_error(TimeoutError("timed out")))
        self.assertTrue(note_service._is_retryable_error(socket.timeout("timed out")))

    def test_oserror_with_transient_errno_is_retryable(self):
        exc = OSError(errno.EPIPE, "Broken pipe")
        self.assertTrue(note_service._is_retryable_error(exc))
        exc = OSError(errno.ECONNRESET, "Connection reset")
        self.assertTrue(note_service._is_retryable_error(exc))
        exc = OSError(errno.ETIMEDOUT, "timed out")
        self.assertTrue(note_service._is_retryable_error(exc))

    def test_httpx_transport_error_is_retryable(self):
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")
        exc = httpx.ConnectTimeout("connect timeout")
        self.assertTrue(note_service._is_retryable_error(exc))
        exc = httpx.ReadTimeout("read timeout")
        self.assertTrue(note_service._is_retryable_error(exc))

    def test_requests_connection_error_is_retryable(self):
        try:
            import requests
        except ImportError:
            self.skipTest("requests not installed")
        exc = requests.exceptions.ConnectionError("connection failed")
        self.assertTrue(note_service._is_retryable_error(exc))
        exc = requests.exceptions.Timeout("request timed out")
        self.assertTrue(note_service._is_retryable_error(exc))

    def test_http_403_is_not_retryable(self):
        # 403 反爬 / 权限拒绝属于永久失败，不应归为可重试
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")
        exc = httpx.HTTPStatusError("403 Forbidden", request=httpx.Request("GET", "https://example.com"), response=httpx.Response(403))
        self.assertFalse(note_service._is_retryable_error(exc))

    def test_generic_value_error_is_not_retryable(self):
        self.assertFalse(note_service._is_retryable_error(ValueError("bad payload")))

    def test_oserror_with_unrelated_errno_is_not_retryable(self):
        # ENOENT 等本地文件系统错误不属于瞬时网络错误
        exc = OSError(errno.ENOENT, "No such file or directory")
        self.assertFalse(note_service._is_retryable_error(exc))


if __name__ == "__main__":
    unittest.main()
