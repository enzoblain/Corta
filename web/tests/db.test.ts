import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, migrate, MIGRATIONS_DIR } from "@/lib/db";
import { setIdeaStatus } from "@/lib/db/queries";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corta-"));
  return connect(path.join(dir, "app.db"));
}

test("migrations apply once and are idempotent", () => {
  const db = tmpDb();
  assert.deepEqual(migrate(db), [1]);
  assert.deepEqual(migrate(db), []);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => (r as { name: string }).name)
    .sort();
  assert.deepEqual(tables, ["idea_tags", "ideas", "projects", "schema_migrations", "tags"]);
});

test("a database created by the Python version is opened without loss", () => {
  const db = tmpDb();
  // What the Python runner leaves behind: schema applied + version 1 recorded.
  db.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "001_init.sql"), "utf-8"));
  db.prepare("INSERT INTO schema_migrations (version) VALUES (1)").run();
  db.prepare("INSERT INTO projects (name) VALUES ('Corta')").run();
  db.prepare("INSERT INTO ideas (project_id, raw_text) VALUES (1, 'idée')").run();
  assert.deepEqual(migrate(db), []);
  assert.equal((db.prepare("SELECT count(*) AS n FROM ideas").get() as { n: number }).n, 1);
});

test("a failing migration is rolled back and not recorded", () => {
  const db = tmpDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corta-mig-"));
  fs.writeFileSync(path.join(dir, "001_bad.sql"), "CREATE TABLE a (x INTEGER); NOT SQL;");
  assert.throws(() => migrate(db, dir));
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").all().length,
    0,
  );
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM schema_migrations").get() as { n: number }).n,
    0,
  );
});

test("foreign keys are enforced and deleting a project sends ideas to the Inbox", () => {
  const db = tmpDb();
  migrate(db);
  assert.throws(() => db.prepare("INSERT INTO ideas (project_id, raw_text) VALUES (99, 'x')").run());
  db.prepare("INSERT INTO projects (name) VALUES ('P')").run();
  db.prepare("INSERT INTO ideas (project_id, raw_text) VALUES (1, 'x')").run();
  db.prepare("DELETE FROM projects WHERE id = 1").run();
  const row = db.prepare("SELECT project_id FROM ideas").get() as { project_id: number | null };
  assert.equal(row.project_id, null);
});

test("status CHECK rejects unknown values", () => {
  const db = tmpDb();
  migrate(db);
  assert.throws(() =>
    db.prepare("INSERT INTO ideas (raw_text, status) VALUES ('x', 'nope')").run(),
  );
});

test("setIdeaStatus updates status and updated_at", () => {
  const db = tmpDb();
  migrate(db);
  db.prepare(
    "INSERT INTO ideas (raw_text, created_at, updated_at) VALUES ('x', '2000-01-01 00:00:00', '2000-01-01 00:00:00')",
  ).run();
  assert.equal(setIdeaStatus(db, 1, "done"), true);
  assert.equal(setIdeaStatus(db, 42, "done"), false);
  const row = db.prepare("SELECT status, updated_at FROM ideas").get() as {
    status: string;
    updated_at: string;
  };
  assert.equal(row.status, "done");
  assert.notEqual(row.updated_at, "2000-01-01 00:00:00");
});
