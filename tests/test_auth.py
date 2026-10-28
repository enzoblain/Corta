import tempfile
import unittest
from pathlib import Path

from app import auth
from app.config import Config
from app.db import connect, migrate
from app.router import Request, Router, json_response
from app.server import build_router, dispatch

CONFIG = Config(app_password="s3cret", session_secret="k" * 32, data_dir=Path("."))


def make_request(method: str, path: str, cookie: str = "", body: str = "") -> Request:
    headers = {"cookie": cookie} if cookie else {}
    return Request(method, path, headers=headers, body=body.encode())


class AuthTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.config = Config(app_password="s3cret", session_secret="k" * 32, data_dir=Path(tmp.name))
        conn = connect(self.config.db_path)
        migrate(conn)
        conn.close()
        self.router = build_router(self.config)

    def dispatch_request(self, *args: str):
        return dispatch(self.router, self.config, make_request(*args))

    def test_password_check(self) -> None:
        self.assertTrue(auth.check_password("s3cret", "s3cret"))
        self.assertFalse(auth.check_password("s3cre", "s3cret"))
        self.assertFalse(auth.check_password("", "s3cret"))

    def test_session_signature_and_expiry(self) -> None:
        token = auth.make_session("k", 100, now=1000)
        self.assertTrue(auth.verify_session("k", token, now=1050))
        self.assertFalse(auth.verify_session("k", token, now=1100))
        self.assertFalse(auth.verify_session("other", token, now=1050))
        exp, sig = token.split(".")
        self.assertFalse(auth.verify_session("k", f"9999999999.{sig}", now=1050))
        for bad in (None, "", "garbage", "a.b"):
            self.assertFalse(auth.verify_session("k", bad))

    def test_unauthenticated_html_redirects(self) -> None:
        for path in ("/", "/nope"):
            r = self.dispatch_request("GET", path)
            self.assertEqual(r.status, 303)
            self.assertIn(("Location", "/login"), r.headers)

    def test_unauthenticated_api_401(self) -> None:
        for method, path in (("GET", "/api/ping"), ("POST", "/api/anything")):
            self.assertEqual(self.dispatch_request(method, path).status, 401)

    def test_login_page_public(self) -> None:
        self.assertEqual(self.dispatch_request("GET", "/login").status, 200)

    def test_wrong_password_rejected(self) -> None:
        r = self.dispatch_request("POST", "/login", "", "password=nope")
        self.assertEqual(r.status, 401)
        self.assertFalse([h for h in r.headers if h[0] == "Set-Cookie"])

    def test_login_flow_and_cookie_flags(self) -> None:
        r = self.dispatch_request("POST", "/login", "", "password=s3cret")
        self.assertEqual(r.status, 303)
        cookie = dict(r.headers)["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        pair = cookie.split(";")[0]
        self.assertEqual(self.dispatch_request("GET", "/", pair).status, 200)
        self.assertEqual(self.dispatch_request("GET", "/api/ping", pair).status, 200)

    def test_forged_cookie_rejected(self) -> None:
        self.assertEqual(self.dispatch_request("GET", "/api/ping", "session=9999999999.deadbeef").status, 401)

    def test_login_error_is_escaped(self) -> None:
        from app.templates import render
        out = render("login.html", error="<script>")
        self.assertNotIn("<script>", out)


class RouterTests(unittest.TestCase):
    def test_resolve(self) -> None:
        r = Router()
        r.add("get", "/a", lambda q: json_response({}), public=True)
        self.assertIsNotNone(r.resolve("GET", "/a"))
        self.assertIsNone(r.resolve("POST", "/a"))

    def test_unknown_route_404_when_authed(self) -> None:
        router = build_router(CONFIG)
        token = auth.make_session(CONFIG.session_secret, 100)
        session_cookie = f"session={token}"
        self.assertEqual(dispatch(router, CONFIG, make_request("GET", "/nope", session_cookie)).status, 404)
        self.assertEqual(dispatch(router, CONFIG, make_request("GET", "/api/nope", session_cookie)).status, 404)

    def test_static_and_traversal(self) -> None:
        router = build_router(CONFIG)
        self.assertEqual(dispatch(router, CONFIG, make_request("GET", "/static/style.css")).status, 200)
        self.assertEqual(dispatch(router, CONFIG, make_request("GET", "/static/../server.py")).status, 404)


if __name__ == "__main__":
    unittest.main()
