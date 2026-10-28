"""SQLite access: connections and the migration runner."""
import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def connect(path: str | Path) -> sqlite3.Connection:
    # isolation_level=None: we manage transactions explicitly.
    conn = sqlite3.connect(str(path), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate(conn: sqlite3.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[int]:
    """Apply pending NNN_name.sql files in order. Returns the versions applied."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version INTEGER PRIMARY KEY,"
        " applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    done = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
    applied: list[int] = []
    for f in sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql")):
        version = int(f.name.split("_", 1)[0])
        if version in done:
            continue
        conn.execute("BEGIN")
        try:
            # Run statement by statement so everything stays in our transaction
            # (executescript would commit implicitly).
            sql = f.read_text(encoding="utf-8")
            buf = ""
            for line in sql.splitlines(keepends=True):
                buf += line
                if sqlite3.complete_statement(buf):
                    conn.execute(buf)
                    buf = ""
            if buf.strip():
                conn.execute(buf)
            conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        applied.append(version)
    return applied
