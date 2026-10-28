"""HTTP server wiring: routes, auth gate, static files. Run: python3 -m app.server"""
import logging
import mimetypes
import sqlite3
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import ai, auth
from .config import Config, load_config
from .db import connect, migrate, queries
from .pages import NOTICES, build_pages
from .router import Request, Response, Router, html_response, json_response, redirect
from .templates import Safe, page, render

STATIC_DIR = Path(__file__).parent / "static"
MAX_BODY = 64 * 1024
log = logging.getLogger("corta")


def is_api(path: str) -> bool:
    return path.startswith("/api/")


MAX_IDEA = 2000


def app_page(title: str, body: Safe) -> Response:
    return html_response(page(title, body, render("nav.html", q="")))


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

    def with_db() -> sqlite3.Connection:
        return connect(config.db_path)

    def suggestion_page(
        raw_text: str, idea_id: str, suggestion: ai.Suggestion, projects: list[tuple[int, str]]
    ) -> Response:
        options = ['<option value="">Inbox (aucun projet)</option>']
        if suggestion.new_project:
            options.append(
                f'<option value="new" selected>➕ Nouveau : {escape(suggestion.new_project)}</option>'
            )
        options += [
            f'<option value="{pid}"{" selected" if pid == suggestion.project_id else ""}>'
            f"{escape(name)}</option>"
            for pid, name in projects
        ]
        return app_page(
            "Valider",
            render(
                "suggestion.html",
                raw_text=raw_text,
                idea_id=idea_id,
                title=suggestion.title,
                content=suggestion.content,
                project_options=Safe("".join(options)),
                new_project=suggestion.new_project,
                tags=", ".join(suggestion.tags),
                cancel_url="/inbox" if idea_id else "/",
            ),
        )

    @router.route("POST", "/capture/suggest")
    def suggest(req: Request) -> Response:
        """Raw idea -> AI suggestion to validate. Nothing is stored unless the AI fails."""
        raw = req.form.get("raw_text", "").strip()[:MAX_IDEA]
        if not raw:
            return redirect("/")
        conn = with_db()
        try:
            projects, tags = queries.list_projects(conn), queries.list_tag_names(conn)
            try:
                suggestion = ai.suggest(config.anthropic_api_key, raw, projects, tags)
            except ai.AIError as e:
                log.warning("AI suggestion failed: %s", e)
                queries.create_idea(conn, raw)  # plan B: raw idea in the Inbox
                code = "ai_error" if config.anthropic_api_key else "no_key"
                return redirect(f"/inbox?notice={code}")
            return suggestion_page(raw, "", suggestion, projects)
        finally:
            conn.close()

    @router.route("POST", "/capture/reprocess")
    def reprocess(req: Request) -> Response:
        conn = with_db()
        try:
            idea = (
                queries.get_idea(conn, int(req.form["idea_id"]))
                if req.form.get("idea_id", "").isdigit()
                else None
            )
            if idea is None or idea["project_id"] is not None:
                return redirect("/inbox")
            projects, tags = queries.list_projects(conn), queries.list_tag_names(conn)
            try:
                suggestion = ai.suggest(config.anthropic_api_key, idea["raw_text"], projects, tags)
            except ai.AIError as e:
                log.warning("AI reprocess failed: %s", e)
                return redirect("/inbox?notice=" + ("reprocess_error" if config.anthropic_api_key else "no_key"))
            return suggestion_page(idea["raw_text"], str(idea["id"]), suggestion, projects)
        finally:
            conn.close()

    @router.route("POST", "/capture/confirm")
    def confirm(req: Request) -> Response:
        form = req.form
        title, content = form.get("title", "").strip(), form.get("content", "").strip()
        tags = ai.normalize_tags(form.get("tags", "").split(","), [])[: ai.MAX_TAGS]
        if not title or not content or not tags:
            return html_response("Titre, reformulation et au moins un tag sont requis.", 400)
        conn = with_db()
        try:
            conn.execute("BEGIN")
            try:
                known = queries.list_tag_names(conn)
                tags = ai.normalize_tags(tags, known)
                new_name = form.get("new_project", "").strip()
                project_id: int | None = None
                choice = form.get("project_id", "")
                if choice == "new":
                    if not new_name:
                        conn.execute("ROLLBACK")
                        return html_response("Nom du nouveau projet requis.", 400)
                    project_id = queries.get_or_create_project(conn, new_name)
                elif choice.isdigit():
                    if int(choice) not in {p for p, _ in queries.list_projects(conn)}:
                        conn.execute("ROLLBACK")
                        return html_response("Projet inconnu.", 400)
                    project_id = int(choice)
                idea_id = int(form["idea_id"]) if form.get("idea_id", "").isdigit() else None
                if idea_id is not None and queries.get_idea(conn, idea_id) is None:
                    idea_id = None
                if idea_id is None:
                    idea_id = queries.create_idea(conn, form.get("raw_text", "").strip() or content)
                queries.update_idea(
                    conn, idea_id, title=title, content=content,
                    project_id=project_id, ai_processed=1,
                )
                queries.set_idea_tags(conn, idea_id, tags)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()
        return redirect("/inbox?notice=saved" if project_id is None else "/?notice=saved")

    @router.route("GET", "/inbox")
    def inbox(req: Request) -> Response:
        notice = NOTICES.get(req.query.get("notice", [""])[0], "")
        conn = with_db()
        try:
            rows = queries.list_inbox(conn)
        finally:
            conn.close()
        items = "".join(
            "<li><strong>{}</strong><br>{}"
            '<form method="post" action="/capture/reprocess">'
            '<input type="hidden" name="idea_id" value="{}">'
            '<button type="submit">Retraiter avec l\'IA</button></form></li>'.format(
                escape(r["title"] or r["raw_text"]), escape(r["content"] or ""), r["id"]
            )
            for r in rows
        ) or "<li>Inbox vide.</li>"
        return app_page("Inbox", render("inbox.html", notice=notice, items=Safe(items)))

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
