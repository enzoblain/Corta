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
