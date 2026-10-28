import type { Db } from "@/lib/db";
import type { IdeaStatus } from "@/lib/types";

// All SQL lives here, parameterized. Every UPDATE ideas must set updated_at
// (no trigger, see CLAUDE.md).

export function setIdeaStatus(db: Db, id: number, status: IdeaStatus): boolean {
  const res = db
    .prepare("UPDATE ideas SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  return res.changes > 0;
}
