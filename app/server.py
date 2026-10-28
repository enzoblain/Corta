"""HTTP server wiring: routes, auth gate, static files. Run: python3 -m app.server"""
import logging
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import auth
from .config import Config, load_config
from .db import connect, migrate
from .pages import build_pages
from .router import Request, Response, Router, html_response, json_response, redirect
from .templates import page, render

STATIC_DIR = Path(__file__).parent / "static"
MAX_BODY = 64 * 1024
log = logging.getLogger("corta")


def is_api(path: str) -> bool:
    return path.startswith("/api/")


def build_router(config: Config, limiter: auth.LoginLimiter | None = None) -> Router:
    router = Router()
    limiter = limiter or auth.LoginLimiter()

    def login_page(error: str = "", status: int = 200) -> Response:
        return html_response(page("Connexion", render("login.html", error=error)), status)

    @router.route("GET", "/login", public=True)
    def login_form(req: Request) -> Response:
        return login_page()

    @router.route("POST", "/login", public=True)
    def login_submit(req: Request) -> Response:
        if limiter.is_blocked(req.client_ip):
            resp = login_page("Trop de tentatives. Réessayez plus tard.", 429)
            resp.headers.append(("Retry-After", str(limiter.window)))
            return resp
        if not auth.check_password(req.form.get("password", ""), config.app_password):
            limiter.record_failure(req.client_ip)
            return login_page("Mot de passe incorrect.", 401)
        limiter.reset(req.client_ip)
        token = auth.make_session(config.session_secret, config.session_ttl)
        cookie = auth.cookie_header(token, config.session_ttl, config.cookie_secure)
        return redirect("/", [("Set-Cookie", cookie)])

    @router.route("POST", "/logout")
    def logout(req: Request) -> Response:
        cookie = auth.cookie_header("", 0, config.cookie_secure)
        return redirect("/login", [("Set-Cookie", cookie)])

    @router.route("GET", "/healthz", public=True)
    def healthz(req: Request) -> Response:
        return json_response({"ok": True})

    @router.route("GET", "/api/ping")
    def ping(req: Request) -> Response:
        return json_response({"pong": True})

    build_pages(router, config)
    return router


def static_response(path: str) -> Response:
    target = (STATIC_DIR / path.removeprefix("/static/")).resolve()
    if not target.is_file() or STATIC_DIR.resolve() not in target.parents:
        return html_response("Not found", 404)
    ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return Response(200, target.read_bytes(), content_type=ctype)


def dispatch(router: Router, config: Config, req: Request) -> Response:
    """Auth gate + routing. Pure function of the request, easy to test."""
    if req.path.startswith("/static/"):
        return static_response(req.path)
    found = router.resolve(req.method, req.path)
    public = found[1] if found else False
    if not public and not auth.verify_session(
        config.session_secret, req.cookies.get(auth.COOKIE_NAME)
    ):
        if is_api(req.path):
            return json_response({"error": "unauthorized"}, 401)
        return redirect("/login")
    if not found:
        if is_api(req.path):
            return json_response({"error": "not found"}, 404)
        return html_response("Page introuvable", 404)
    try:
        return found[0](req)
    except Exception:
        log.exception("Unhandled error on %s %s", req.method, req.path)
        if is_api(req.path):
            return json_response({"error": "internal error"}, 500)
        return html_response("Erreur interne", 500)


def make_handler(router: Router, config: Config) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _handle(self) -> None:
            parts = urlsplit(self.path)
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0:
                self.send_error(400)
                return
            if length > MAX_BODY:
                self.send_error(413)
                return
            req = Request(
                method=self.command,
                path=parts.path,
                query=parse_qs(parts.query),
                headers={k.lower(): v for k, v in self.headers.items()},
                body=self.rfile.read(length) if length else b"",
                client_ip=self.client_address[0],
            )
            resp = dispatch(router, config, req)
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.content_type)
            self.send_header("Content-Length", str(len(resp.body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in resp.headers:
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(resp.body)

        do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

    return Handler


def main() -> None:
    config = load_config()
    config.data_dir.mkdir(parents=True, exist_ok=True)
    conn = connect(config.db_path)
    applied = migrate(conn)
    conn.close()
    print(f"Migrations applied: {applied or 'none'}")
    router = build_router(config)
    server = ThreadingHTTPServer((config.host, config.port), make_handler(router, config))
    print(f"Listening on http://{config.host}:{config.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
