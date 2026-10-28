import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.db import connect, migrate
from app.db.queries import create_idea, update_idea


class MigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "t.db"

    def test_idempotent_and_persistent(self) -> None:
        conn = connect(self.path)
        self.assertEqual(migrate(conn), [1])
        self.assertEqual(migrate(conn), [])
        conn.execute("INSERT INTO projects (name) VALUES ('p')")
        conn.close()
        conn = connect(self.path)  # "restart"
        self.assertEqual(migrate(conn), [])
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 1)

    def test_foreign_keys_and_set_null(self) -> None:
        conn = connect(self.path)
        migrate(conn)
        self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO ideas (raw_text, project_id) VALUES ('x', 999)")
        conn.execute("INSERT INTO projects (id, name) VALUES (1, 'p')")
        idea = create_idea(conn, "hello", 1)
        conn.execute("DELETE FROM projects WHERE id = 1")
        row = conn.execute("SELECT project_id FROM ideas WHERE id = ?", (idea,)).fetchone()
        self.assertIsNone(row["project_id"])

    def test_failed_migration_rolls_back(self) -> None:
        migrations_dir = Path(self.tmp.name) / "m"
        migrations_dir.mkdir()
        (migrations_dir / "001_bad.sql").write_text("CREATE TABLE a (x INTEGER);\nCREATE TABLE a (y INTEGER);\n")
        conn = connect(self.path)
        with self.assertRaises(sqlite3.OperationalError):
            migrate(conn, migrations_dir)
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
        self.assertNotIn("a", tables)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 0)

    def test_update_refreshes_updated_at(self) -> None:
        conn = connect(self.path)
        migrate(conn)
        idea = create_idea(conn, "x")
        conn.execute("UPDATE ideas SET updated_at = '2000-01-01 00:00:00' WHERE id = ?", (idea,))
        update_idea(conn, idea, status="done")
        row = conn.execute("SELECT status, updated_at FROM ideas WHERE id = ?", (idea,)).fetchone()
        self.assertEqual(row["status"], "done")
        self.assertNotEqual(row["updated_at"], "2000-01-01 00:00:00")
        with self.assertRaises(ValueError):
            update_idea(conn, idea, id=5)


if __name__ == "__main__":
    unittest.main()
