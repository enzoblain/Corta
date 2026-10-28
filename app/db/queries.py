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


STATUSES = ("todo", "in_progress", "done")


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
    return create_project(conn, name)


def create_project(conn: sqlite3.Connection, name: str) -> int:
    cur = conn.execute("INSERT INTO projects (name) VALUES (?)", (name,))
    assert cur.lastrowid is not None
    return cur.lastrowid


def rename_project(conn: sqlite3.Connection, project_id: int, name: str) -> None:
    conn.execute("UPDATE projects SET name = ? WHERE id = ?", (name, project_id))


def delete_project(conn: sqlite3.Connection, project_id: int) -> None:
    # ideas.project_id goes back to NULL (Inbox) through ON DELETE SET NULL
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


def get_project(conn: sqlite3.Connection, project_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()


def _count_columns() -> str:
    return ", ".join(
        f"COALESCE(SUM(i.status = '{s}'), 0) AS {s}" for s in STATUSES  # constants only
    )


def project_counts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every project with its idea counts per status (todo, in_progress, done)."""
    return conn.execute(
        f"SELECT p.id, p.name, {_count_columns()} FROM projects p"
        " LEFT JOIN ideas i ON i.project_id = p.id GROUP BY p.id ORDER BY p.name COLLATE NOCASE"
    ).fetchall()


def inbox_counts(conn: sqlite3.Connection) -> sqlite3.Row:
    return conn.execute(
        f"SELECT {_count_columns()} FROM ideas i WHERE i.project_id IS NULL"
    ).fetchone()


def list_ideas(
    conn: sqlite3.Connection,
    project_id: int | None,
    status: str | None = None,
    tag: str | None = None,
) -> list[sqlite3.Row]:
    """Ideas of a project (None = Inbox), optionally filtered by status and tag name."""
    sql = "SELECT i.* FROM ideas i WHERE i.project_id IS ?"
    params: list[object] = [project_id]
    if status:
        sql += " AND i.status = ?"
        params.append(status)
    if tag:
        sql += (
            " AND i.id IN (SELECT it.idea_id FROM idea_tags it"
            " JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)"
        )
        params.append(tag)
    return conn.execute(sql + " ORDER BY i.created_at DESC, i.id DESC", params).fetchall()


def tags_of_ideas(conn: sqlite3.Connection, idea_ids: list[int]) -> dict[int, list[str]]:
    if not idea_ids:
        return {}
    marks = ", ".join("?" for _ in idea_ids)  # placeholders only
    rows = conn.execute(
        "SELECT it.idea_id, t.name FROM idea_tags it JOIN tags t ON t.id = it.tag_id"
        f" WHERE it.idea_id IN ({marks}) ORDER BY t.name",
        idea_ids,
    ).fetchall()
    out: dict[int, list[str]] = {i: [] for i in idea_ids}
    for r in rows:
        out[r["idea_id"]].append(r["name"])
    return out


def project_tags(conn: sqlite3.Connection, project_id: int | None) -> list[str]:
    rows = conn.execute(
        "SELECT DISTINCT t.name FROM tags t JOIN idea_tags it ON it.tag_id = t.id"
        " JOIN ideas i ON i.id = it.idea_id WHERE i.project_id IS ? ORDER BY t.name",
        (project_id,),
    ).fetchall()
    return [r["name"] for r in rows]


def set_idea_tags(conn: sqlite3.Connection, idea_id: int, names: list[str]) -> None:
    """Replace the tags of an idea (names are created on demand)."""
    conn.execute("DELETE FROM idea_tags WHERE idea_id = ?", (idea_id,))
    for name in dict.fromkeys(names):
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        conn.execute(
            "INSERT INTO idea_tags (idea_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
            (idea_id, name),
        )
    conn.execute("UPDATE ideas SET updated_at = datetime('now') WHERE id = ?", (idea_id,))


def _like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_ideas(conn: sqlite3.Connection, term: str) -> list[sqlite3.Row]:
    """Case-insensitive LIKE over title, content and raw text."""
    pattern = _like_pattern(term)
    return conn.execute(
        "SELECT * FROM ideas WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'"
        " OR raw_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC, id DESC",
        (pattern, pattern, pattern),
    ).fetchall()
