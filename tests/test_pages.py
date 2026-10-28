import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from app import auth
from app.config import Config
from app.db import connect, migrate, queries
from app.router import Request, Response
from app.server import build_router, dispatch


class QueryTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.conn = connect(Path(tmp.name) / "t.db")
        self.addCleanup(self.conn.close)
        migrate(self.conn)

    def test_counts_and_inbox(self) -> None:
        p = queries.create_project(self.conn, "Alpha")
        a = queries.create_idea(self.conn, "a", p)
        queries.create_idea(self.conn, "b", p)
        queries.create_idea(self.conn, "c", None)
        queries.update_idea(self.conn, a, status="done")
        row = queries.project_counts(self.conn)[0]
        self.assertEqual((row["todo"], row["in_progress"], row["done"]), (1, 0, 1))
        self.assertEqual(queries.inbox_counts(self.conn)["todo"], 1)
        empty = queries.create_project(self.conn, "Beta")
        self.assertEqual(queries.project_counts(self.conn)[1]["todo"], 0)
        self.assertIsNotNone(queries.get_project(self.conn, empty))

    def test_rename_delete_sends_ideas_to_inbox(self) -> None:
        p = queries.create_project(self.conn, "Alpha")
        queries.rename_project(self.conn, p, "Gamma")
        self.assertEqual(queries.get_project(self.conn, p)["name"], "Gamma")
        i = queries.create_idea(self.conn, "x", p)
        queries.delete_project(self.conn, p)
        self.assertIsNone(queries.get_idea(self.conn, i)["project_id"])
        self.assertEqual([r["id"] for r in queries.list_ideas(self.conn, None)], [i])

    def test_filters_and_tags(self) -> None:
        p = queries.create_project(self.conn, "Alpha")
        a = queries.create_idea(self.conn, "a", p)
        b = queries.create_idea(self.conn, "b", p)
        queries.set_idea_tags(self.conn, a, ["web", "web", "ia"])
        queries.set_idea_tags(self.conn, b, ["ia"])
        queries.update_idea(self.conn, b, status="in_progress")
        ids = lambda **kw: sorted(r["id"] for r in queries.list_ideas(self.conn, p, **kw))
        self.assertEqual(ids(), [a, b])
        self.assertEqual(ids(status="in_progress"), [b])
        self.assertEqual(ids(tag="web"), [a])
        self.assertEqual(ids(tag="ia", status="todo"), [a])
        self.assertEqual(queries.project_tags(self.conn, p), ["ia", "web"])
        self.assertEqual(queries.tags_of_ideas(self.conn, [a, b]), {a: ["ia", "web"], b: ["ia"]})
        queries.set_idea_tags(self.conn, a, [])
        self.assertEqual(queries.tags_of_ideas(self.conn, [a]), {a: []})

    def test_move_idea(self) -> None:
        p = queries.create_project(self.conn, "Alpha")
        i = queries.create_idea(self.conn, "x", None)
        queries.update_idea(self.conn, i, project_id=p)
        self.assertEqual(queries.get_idea(self.conn, i)["project_id"], p)

    def test_search_title_content_raw_and_wildcards(self) -> None:
        a = queries.create_idea(self.conn, "brut zebra", None)
        b = queries.create_idea(self.conn, "x", None)
        c = queries.create_idea(self.conn, "y", None)
        queries.update_idea(self.conn, b, title="Licorne", content="rien")
        queries.update_idea(self.conn, c, content="un dragon ici 100%")
        found = lambda t: [r["id"] for r in queries.search_ideas(self.conn, t)]
        self.assertEqual(found("zebra"), [a])
        self.assertEqual(found("licorne"), [b])
        self.assertEqual(found("dragon"), [c])
        self.assertEqual(found("100%"), [c])
        self.assertEqual(found("%"), [c])  # wildcard is escaped
        self.assertEqual(found("_"), [])


class PageTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.config = Config(app_password="s3cret", session_secret="k" * 32, data_dir=Path(tmp.name))
        conn = connect(self.config.db_path)
        migrate(conn)
        conn.close()
        self.router = build_router(self.config)
        self.cookie = "session=" + auth.make_session(self.config.session_secret, 100)

    def call(self, method: str, path: str, body: str = "") -> Response:
        parts = urlsplit(path)
        req = Request(
            method, parts.path, parse_qs(parts.query), {"cookie": self.cookie}, body.encode()
        )
        return dispatch(self.router, self.config, req)

    def text(self, resp: Response) -> str:
        return resp.body.decode() if isinstance(resp.body, bytes) else str(resp.body)

    def test_project_lifecycle_and_inbox(self) -> None:
        self.assertEqual(self.call("POST", "/projects/create", "name=%3Cb%3EAlpha").status, 303)
        conn = connect(self.config.db_path)
        pid = queries.list_projects(conn)[0]["id"]
        idea = queries.create_idea(conn, "mon idee", pid)
        conn.close()
        home = self.text(self.call("GET", "/"))
        self.assertIn("&lt;b&gt;Alpha", home)
        self.assertNotIn("<b>Alpha", home)
        self.assertEqual(self.call("POST", "/projects/create", "name=%3Cb%3EAlpha").status, 409)
        self.assertEqual(self.call("POST", "/projects/rename", f"id={pid}&name=Beta").status, 303)
        self.assertEqual(self.call("POST", "/projects/delete", f"id={pid}").status, 303)
        self.assertIn("mon idee", self.text(self.call("GET", "/project")))
        self.assertEqual(self.call("GET", f"/project?id={pid}").status, 404)
        self.assertEqual(self.call("GET", f"/idea?id={idea}").status, 200)

    def test_status_api_and_edit(self) -> None:
        conn = connect(self.config.db_path)
        idea = queries.create_idea(conn, "brut", None)
        pid = queries.create_project(conn, "P")
        conn.close()
        self.assertEqual(self.call("POST", "/api/idea/status", f"id={idea}&status=done").status, 200)
        self.assertEqual(self.call("POST", "/api/idea/status", f"id={idea}&status=nope").status, 400)
        self.assertEqual(self.call("POST", "/api/idea/status", "id=999&status=done").status, 404)
        body = f"id={idea}&title=T&content=C&project_id={pid}&status=in_progress&tags=a,+B"
        self.assertEqual(self.call("POST", "/idea", body).status, 303)
        conn = connect(self.config.db_path)
        row = queries.get_idea(conn, idea)
        self.assertEqual((row["title"], row["project_id"], row["status"]), ("T", pid, "in_progress"))
        self.assertEqual(queries.tags_of_ideas(conn, [idea])[idea], ["a", "b"])
        conn.close()
        self.assertIn("brut", self.text(self.call("GET", f"/idea?id={idea}")))
        self.assertIn("T", self.text(self.call("GET", f"/project?id={pid}&status=in_progress&tag=a")))
        self.assertIn("1 résultat", self.text(self.call("GET", "/search?q=brut")))
        self.assertEqual(self.call("POST", "/idea", f"id={idea}&status=done&project_id=999").status, 400)
