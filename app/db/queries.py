"""Hand-written, parameterized SQL. Every UPDATE must refresh updated_at here (no trigger)."""
import sqlite3

IDEA_FIELDS = ("project_id", "raw_text", "title", "content", "status", "ai_processed")


def create_idea(conn: sqlite3.Connection, raw_text: str, project_id: int | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO ideas (raw_text, project_id) VALUES (?, ?)", (raw_text, project_id)
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def update_idea(conn: sqlite3.Connection, idea_id: int, **fields: object) -> None:
    unknown = set(fields) - set(IDEA_FIELDS)
    if unknown or not fields:
        raise ValueError(f"Invalid idea fields: {sorted(unknown) or 'none given'}")
    assignments = ", ".join(f"{name} = ?" for name in fields)  # names are whitelisted
    conn.execute(
        f"UPDATE ideas SET {assignments}, updated_at = datetime('now') WHERE id = ?",
        (*fields.values(), idea_id),
    )


def list_projects(conn: sqlite3.Connection) -> list[tuple[int, str]]:
    rows = conn.execute("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE")
    return [(r["id"], r["name"]) for r in rows]


def list_tag_names(conn: sqlite3.Connection) -> list[str]:
    return [r["name"] for r in conn.execute("SELECT name FROM tags ORDER BY name")]


def get_idea(conn: sqlite3.Connection, idea_id: int) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM ideas WHERE id = ?", (idea_id,)
    ).fetchone()
    return row


def list_inbox(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM ideas WHERE project_id IS NULL ORDER BY created_at DESC, id DESC"
    ).fetchall()


def get_or_create_project(conn: sqlite3.Connection, name: str) -> int:
    row = conn.execute(
        "SELECT id FROM projects WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute("INSERT INTO projects (name) VALUES (?)", (name,))
    assert cur.lastrowid is not None
    return cur.lastrowid


def set_idea_tags(conn: sqlite3.Connection, idea_id: int, tags: list[str]) -> None:
    conn.execute("DELETE FROM idea_tags WHERE idea_id = ?", (idea_id,))
    for name in tags:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        conn.execute(
            "INSERT OR IGNORE INTO idea_tags (idea_id, tag_id) "
            "SELECT ?, id FROM tags WHERE name = ?",
            (idea_id, name),
        )
