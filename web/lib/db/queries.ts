import type { Db } from "@/lib/db";
import type { Idea, IdeaStatus, Project } from "@/lib/types";

// All SQL lives here, parameterized. Every UPDATE ideas must set updated_at
// (no trigger, see CLAUDE.md).

export const STATUSES: readonly IdeaStatus[] = ["todo", "in_progress", "done"];

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Fini",
};

export function isStatus(value: unknown): value is IdeaStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export type StatusCounts = Record<IdeaStatus, number>;
export interface ProjectCounts extends StatusCounts {
  id: number;
  name: string;
}

// Constants only, never user input.
const COUNT_COLUMNS = STATUSES.map((s) => `COALESCE(SUM(i.status = '${s}'), 0) AS ${s}`).join(", ");

// --- ideas ---

export function createIdea(db: Db, rawText: string, projectId: number | null = null): number {
  const res = db
    .prepare("INSERT INTO ideas (raw_text, project_id) VALUES (?, ?)")
    .run(rawText, projectId);
  return Number(res.lastInsertRowid);
}

export function getIdea(db: Db, id: number): Idea | undefined {
  return db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Idea | undefined;
}

export function setIdeaStatus(db: Db, id: number, status: IdeaStatus): boolean {
  const res = db
    .prepare("UPDATE ideas SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  return res.changes > 0;
}

export interface IdeaEdit {
  title: string | null;
  content: string | null;
  projectId: number | null;
  status: IdeaStatus;
}

export function updateIdea(db: Db, id: number, edit: IdeaEdit): boolean {
  const res = db
    .prepare(
      "UPDATE ideas SET title = ?, content = ?, project_id = ?, status = ?," +
        " updated_at = datetime('now') WHERE id = ?",
    )
    .run(edit.title, edit.content, edit.projectId, edit.status, id);
  return res.changes > 0;
}

/** Ideas of a project (null = Inbox), optionally filtered by status and tag name. */
export function listIdeas(
  db: Db,
  projectId: number | null,
  status?: IdeaStatus | null,
  tag?: string | null,
): Idea[] {
  let sql = "SELECT i.* FROM ideas i WHERE i.project_id IS ?";
  const params: (number | string | null)[] = [projectId];
  if (status) {
    sql += " AND i.status = ?";
    params.push(status);
  }
  if (tag) {
    sql +=
      " AND i.id IN (SELECT it.idea_id FROM idea_tags it" +
      " JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)";
    params.push(tag);
  }
  return db.prepare(sql + " ORDER BY i.created_at DESC, i.id DESC").all(...params) as Idea[];
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Case-insensitive LIKE over title, content and raw text; %, _ and \ are literal. */
export function searchIdeas(db: Db, term: string): Idea[] {
  const p = likePattern(term);
  return db
    .prepare(
      "SELECT * FROM ideas WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'" +
        " OR raw_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC, id DESC",
    )
    .all(p, p, p) as Idea[];
}

// --- projects ---

export function listProjects(db: Db): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE").all() as Project[];
}

export function getProject(db: Db, id: number): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

/** Throws on a duplicate name (UNIQUE). */
export function createProject(db: Db, name: string): number {
  const res = db.prepare("INSERT INTO projects (name) VALUES (?)").run(name);
  return Number(res.lastInsertRowid);
}

export function renameProject(db: Db, id: number, name: string): boolean {
  return db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id).changes > 0;
}

/** Ideas go back to the Inbox through ON DELETE SET NULL. */
export function deleteProject(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

/** Every project with its idea counts per status. */
export function projectCounts(db: Db): ProjectCounts[] {
  return db
    .prepare(
      `SELECT p.id, p.name, ${COUNT_COLUMNS} FROM projects p` +
        " LEFT JOIN ideas i ON i.project_id = p.id GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
    )
    .all() as ProjectCounts[];
}

export function inboxCounts(db: Db): StatusCounts {
  return db
    .prepare(`SELECT ${COUNT_COLUMNS} FROM ideas i WHERE i.project_id IS NULL`)
    .get() as StatusCounts;
}

// --- tags ---

export function listTagNames(db: Db): string[] {
  return (db.prepare("SELECT name FROM tags ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

export function tagsOfIdeas(db: Db, ideaIds: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>(ideaIds.map((id) => [id, []]));
  if (ideaIds.length === 0) return out;
  const marks = ideaIds.map(() => "?").join(", "); // placeholders only
  const rows = db
    .prepare(
      "SELECT it.idea_id, t.name FROM idea_tags it JOIN tags t ON t.id = it.tag_id" +
        ` WHERE it.idea_id IN (${marks}) ORDER BY t.name`,
    )
    .all(...ideaIds) as { idea_id: number; name: string }[];
  for (const r of rows) out.get(r.idea_id)?.push(r.name);
  return out;
}

export function projectTags(db: Db, projectId: number | null): string[] {
  const rows = db
    .prepare(
      "SELECT DISTINCT t.name FROM tags t JOIN idea_tags it ON it.tag_id = t.id" +
        " JOIN ideas i ON i.id = it.idea_id WHERE i.project_id IS ? ORDER BY t.name",
    )
    .all(projectId) as { name: string }[];
  return rows.map((r) => r.name);
}

/** Replaces the tags of an idea (created on demand) and refreshes updated_at. */
export function setIdeaTags(db: Db, ideaId: number, names: string[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM idea_tags WHERE idea_id = ?").run(ideaId);
    const addTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
    const link = db.prepare(
      "INSERT INTO idea_tags (idea_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
    );
    for (const name of new Set(names)) {
      addTag.run(name);
      link.run(ideaId, name);
    }
    db.prepare("UPDATE ideas SET updated_at = datetime('now') WHERE id = ?").run(ideaId);
  })();
}

/** Trim, lowercase, dedupe; reuse the exact spelling of an existing tag when it matches. */
export function normalizeTags(raw: string[], known: string[]): string[] {
  const byLower = new Map(known.map((t) => [t.toLowerCase(), t]));
  const out: string[] = [];
  for (const item of raw) {
    const tag = item.trim().replace(/^#/, "").trim();
    if (!tag) continue;
    const name = byLower.get(tag.toLowerCase()) ?? tag.toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
