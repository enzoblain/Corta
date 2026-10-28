import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dbPath, getConfig } from "@/lib/config";

export type Db = Database.Database;

export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "lib", "db", "migrations");

/** Opens a connection with foreign keys enforced. Every connection goes through here. */
export function connect(file: string): Db {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  return db;
}

/** Applies pending NNN_name.sql files in order. Returns the versions applied. */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      " version INTEGER PRIMARY KEY," +
      " applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const insert = db.prepare("INSERT INTO schema_migrations (version) VALUES (?)");
  const applied: number[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, file), "utf-8");
    db.transaction(() => {
      db.exec(sql);
      insert.run(version);
    })();
    applied.push(version);
  }
  return applied;
}

const globalForDb = globalThis as unknown as { __db?: Db };

/** Process-wide connection, created and migrated on first use. */
export function getDb(): Db {
  if (!globalForDb.__db) {
    const config = getConfig();
    fs.mkdirSync(config.dataDir, { recursive: true });
    const db = connect(dbPath(config));
    migrate(db);
    globalForDb.__db = db;
  }
  return globalForDb.__db;
}
