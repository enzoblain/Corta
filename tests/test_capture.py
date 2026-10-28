import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from app import ai, auth
from app.config import Config
from app.db import connect, migrate
from app.router import Request
from app.server import build_router, dispatch


class CaptureRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.config = Config(
            app_password="x", session_secret="k" * 32, data_dir=Path(tmp.name),
            anthropic_api_key="key",
        )
        conn = connect(self.config.db_path)
        migrate(conn)
        conn.execute("INSERT INTO projects (name) VALUES ('Maison')")
        conn.commit()
        conn.close()
        self.router = build_router(self.config)
        self.cookie = f"{auth.COOKIE_NAME}={auth.make_session(self.config.session_secret, 3600)}"

    def post(self, path: str, **form: str):  # type: ignore[no-untyped-def]
        req = Request(
            "POST", path, body=urlencode(form).encode(), headers={"cookie": self.cookie}
        )
        return dispatch(self.router, self.config, req)

    def query(self, sql: str) -> list[tuple[object, ...]]:
        conn = connect(self.config.db_path)
        try:
            return [tuple(r) for r in conn.execute(sql)]
        finally:
            conn.close()

    def suggestion(self, **over: object) -> ai.Suggestion:
        fields: dict[str, object] = dict(
            title="T", content="C", project_id=None, new_project="Jardin", tags=["a"]
        )
        fields.update(over)
        return ai.Suggestion(**fields)  # type: ignore[arg-type]

    def confirm(self, **over: str):  # type: ignore[no-untyped-def]
        form = dict(raw_text="raw", title="T", content="C", tags="a", project_id="")
        form.update(over)
        return self.post("/capture/confirm", **form)

    def test_ai_failure_keeps_raw_idea_in_inbox(self) -> None:
        with mock.patch("app.ai.suggest", side_effect=ai.AIError("boom")):
            resp = self.post("/capture/suggest", raw_text="une idée")
        self.assertEqual(resp.status, 303)
        self.assertEqual(
            self.query("SELECT raw_text, project_id, ai_processed FROM ideas"),
            [("une idée", None, 0)],
        )

    def test_successful_suggest_stores_nothing(self) -> None:
        with mock.patch("app.ai.suggest", return_value=self.suggestion()):
            resp = self.post("/capture/suggest", raw_text="une idée")
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.query("SELECT * FROM ideas"), [])
        self.assertEqual(len(self.query("SELECT * FROM projects")), 1)

    def test_confirm_existing_project_ignores_new_project_field(self) -> None:
        resp = self.confirm(project_id="1", new_project="Jardin")
        self.assertEqual(resp.status, 303)
        self.assertEqual(self.query("SELECT name FROM projects"), [("Maison",)])
        self.assertEqual(self.query("SELECT project_id, ai_processed FROM ideas"), [(1, 1)])

    def test_confirm_new_project_creates_it_once(self) -> None:
        self.confirm(project_id="new", new_project="Jardin")
        self.confirm(project_id="new", new_project="jardin")
        self.assertEqual(len(self.query("SELECT * FROM projects")), 2)
        self.assertEqual(self.query("SELECT DISTINCT project_id FROM ideas"), [(2,)])

    def test_confirm_unknown_project_rejected(self) -> None:
        self.assertEqual(self.confirm(project_id="999").status, 400)
        self.assertEqual(self.query("SELECT * FROM ideas"), [])

    def test_reprocess_then_confirm_updates_same_row(self) -> None:
        with mock.patch("app.ai.suggest", side_effect=ai.AIError("boom")):
            self.post("/capture/suggest", raw_text="une idée")
        with mock.patch("app.ai.suggest", return_value=self.suggestion(project_id=1)):
            resp = self.post("/capture/reprocess", idea_id="1")
        self.assertEqual(resp.status, 200)
        self.confirm(idea_id="1", project_id="1")
        self.assertEqual(
            self.query("SELECT id, raw_text, title, project_id, ai_processed FROM ideas"),
            [(1, "une idée", "T", 1, 1)],
        )
