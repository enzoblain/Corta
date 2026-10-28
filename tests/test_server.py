import http.client
import threading
import unittest
from pathlib import Path

from app import auth
from app.config import Config, load_config
from app.router import Request, Response
from app.server import build_router, dispatch, make_handler
from http.server import ThreadingHTTPServer
from unittest import mock

CONFIG = Config(app_password="s3cret", session_secret="k" * 32, data_dir=Path("."))


def login_request(password: str, ip: str = "1.2.3.4") -> Request:
    return Request("POST", "/login", body=f"password={password}".encode(), client_ip=ip)


class LoginLimiterTests(unittest.TestCase):
    def test_blocks_after_max_failures_then_expires(self) -> None:
        limiter = auth.LoginLimiter(max_failures=3, window=100)
        for _ in range(3):
            self.assertFalse(limiter.is_blocked("ip", now=1000))
            limiter.record_failure("ip", now=1000)
        self.assertTrue(limiter.is_blocked("ip", now=1050))
        self.assertFalse(limiter.is_blocked("other", now=1050))
        self.assertFalse(limiter.is_blocked("ip", now=1101))

    def test_login_returns_429_even_with_right_password(self) -> None:
        router = build_router(CONFIG, auth.LoginLimiter(max_failures=2, window=100))
        for _ in range(2):
            self.assertEqual(dispatch(router, CONFIG, login_request("bad")).status, 401)
        resp = dispatch(router, CONFIG, login_request("s3cret"))
        self.assertEqual(resp.status, 429)
        self.assertFalse([h for h in resp.headers if h[0] == "Set-Cookie"])
        # another client is unaffected, and success resets its counter
        self.assertEqual(dispatch(router, CONFIG, login_request("s3cret", "9.9.9.9")).status, 303)


class ConfigTests(unittest.TestCase):
    def test_weak_values_rejected(self) -> None:
        for env in (
            {"APP_PASSWORD": "change-me", "SESSION_SECRET": "k" * 32},
            {"APP_PASSWORD": "ok", "SESSION_SECRET": "x"},
        ):
            with mock.patch.dict("os.environ", env, clear=True), self.assertRaises(SystemExit):
                load_config()


class HttpServerTests(unittest.TestCase):
    def setUp(self) -> None:
        router = build_router(CONFIG)

        def boom(req: Request) -> Response:
            raise RuntimeError("boom")

        router.add("GET", "/boom", boom, public=True)
        router.add("GET", "/api/boom", boom, public=True)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(router, CONFIG))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def send(self, method: str, path: str, headers: dict[str, str] | None = None) -> http.client.HTTPResponse:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request(method, path, headers=headers or {})
        return conn.getresponse()

    def test_invalid_content_length_is_400(self) -> None:
        for value in ("-1", "abc"):
            self.assertEqual(self.send("POST", "/login", {"Content-Length": value}).status, 400)

    def test_too_large_body_is_413(self) -> None:
        self.assertEqual(self.send("POST", "/login", {"Content-Length": "99999999"}).status, 413)

    def test_handler_exception_returns_500(self) -> None:
        with self.assertLogs("corta", level="ERROR"):
            self.assertEqual(self.send("GET", "/boom").status, 500)
        with self.assertLogs("corta", level="ERROR"):
            resp = self.send("GET", "/api/boom")
        self.assertEqual(resp.status, 500)
        self.assertEqual(resp.getheader("Content-Type"), "application/json")

    def test_head_healthz(self) -> None:
        self.assertEqual(self.send("HEAD", "/healthz").status, 200)


if __name__ == "__main__":
    unittest.main()
