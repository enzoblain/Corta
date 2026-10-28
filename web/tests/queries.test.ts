import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, migrate } from "@/lib/db";
import * as q from "@/lib/db/queries";

function freshDb() {
  const db = connect(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corta-q-")), "app.db"));
  migrate(db);
  return db;
}

test("projectCounts and inboxCounts count per status, including empty projects", () => {
  const db = freshDb();
  const a = q.createProject(db, "alpha");
  q.createProject(db, "Beta");
  const i1 = q.createIdea(db, "x", a);
  q.createIdea(db, "y", a);
  q.createIdea(db, "z");
  q.setIdeaStatus(db, i1, "done");
  const counts = q.projectCounts(db);
  assert.deepEqual(
    counts.map((c) => [c.name, c.todo, c.in_progress, c.done]),
    [["alpha", 1, 0, 1], ["Beta", 0, 0, 0]],
  );
  assert.deepEqual(q.inboxCounts(db), { todo: 1, in_progress: 0, done: 0 });
});

test("project CRUD: duplicate names rejected, delete sends ideas to the Inbox", () => {
  const db = freshDb();
  const p = q.createProject(db, "P");
  assert.throws(() => q.createProject(db, "P"));
  assert.equal(q.renameProject(db, p, "Q"), true);
  assert.equal(q.getProject(db, p)?.name, "Q");
  const idea = q.createIdea(db, "x", p);
  assert.equal(q.deleteProject(db, p), true);
  assert.equal(q.deleteProject(db, p), false);
  assert.equal(q.getIdea(db, idea)?.project_id, null);
  assert.equal(q.listIdeas(db, null).length, 1);
});

test("listIdeas filters by project, status and tag", () => {
  const db = freshDb();
  const p = q.createProject(db, "P");
  const a = q.createIdea(db, "a", p);
  const b = q.createIdea(db, "b", p);
  q.createIdea(db, "inbox");
  q.setIdeaStatus(db, b, "in_progress");
  q.setIdeaTags(db, a, ["web", "ui"]);
  q.setIdeaTags(db, b, ["web"]);
  assert.deepEqual(q.listIdeas(db, p).map((i) => i.raw_text), ["b", "a"]);
  assert.deepEqual(q.listIdeas(db, p, "in_progress").map((i) => i.raw_text), ["b"]);
  assert.deepEqual(q.listIdeas(db, p, null, "ui").map((i) => i.raw_text), ["a"]);
  assert.deepEqual(q.listIdeas(db, p, "todo", "web").map((i) => i.raw_text), ["a"]);
  assert.deepEqual(q.listIdeas(db, null).map((i) => i.raw_text), ["inbox"]);
  assert.deepEqual(q.projectTags(db, p), ["ui", "web"]);
  assert.deepEqual(q.projectTags(db, null), []);
});

test("setIdeaTags replaces tags, dedupes and refreshes updated_at", () => {
  const db = freshDb();
  const id = q.createIdea(db, "x");
  db.prepare("UPDATE ideas SET updated_at = '2000-01-01 00:00:00'").run();
  q.setIdeaTags(db, id, ["a", "b", "a"]);
  assert.deepEqual(q.tagsOfIdeas(db, [id]).get(id), ["a", "b"]);
  assert.notEqual(q.getIdea(db, id)?.updated_at, "2000-01-01 00:00:00");
  q.setIdeaTags(db, id, ["c"]);
  assert.deepEqual(q.tagsOfIdeas(db, [id]).get(id), ["c"]);
  assert.deepEqual(q.tagsOfIdeas(db, []).size, 0);
});

test("updateIdea edits fields, moves to the Inbox and refreshes updated_at", () => {
  const db = freshDb();
  const p = q.createProject(db, "P");
  const id = q.createIdea(db, "raw", p);
  db.prepare("UPDATE ideas SET updated_at = '2000-01-01 00:00:00'").run();
  assert.equal(q.updateIdea(db, id, { title: "T", content: null, projectId: null, status: "done" }), true);
  const idea = q.getIdea(db, id);
  assert.equal(idea?.title, "T");
  assert.equal(idea?.project_id, null);
  assert.equal(idea?.status, "done");
  assert.equal(idea?.raw_text, "raw");
  assert.notEqual(idea?.updated_at, "2000-01-01 00:00:00");
  assert.equal(q.updateIdea(db, 99, { title: null, content: null, projectId: null, status: "todo" }), false);
});

test("searchIdeas is case-insensitive, covers all text columns and escapes LIKE wildcards", () => {
  const db = freshDb();
  const t = q.createIdea(db, "r1");
  const c = q.createIdea(db, "r2");
  q.createIdea(db, "100% sûr");
  q.createIdea(db, "a_b");
  q.createIdea(db, "axb");
  q.updateIdea(db, t, { title: "Hello", content: null, projectId: null, status: "todo" });
  q.updateIdea(db, c, { title: null, content: "WORLD", projectId: null, status: "todo" });
  assert.deepEqual(q.searchIdeas(db, "hello").map((i) => i.id), [t]);
  assert.deepEqual(q.searchIdeas(db, "world").map((i) => i.id), [c]);
  assert.equal(q.searchIdeas(db, "r1").length, 1);
  assert.equal(q.searchIdeas(db, "%").length, 1);
  assert.equal(q.searchIdeas(db, "a_b").length, 1);
  assert.equal(q.searchIdeas(db, "\\").length, 0);
  assert.equal(q.searchIdeas(db, "'; DROP TABLE ideas; --").length, 0);
});

test("normalizeTags trims, lowercases, dedupes and reuses known spelling", () => {
  assert.deepEqual(q.normalizeTags([" #Web ", "web", "", "UI", "Api"], ["API"]), ["web", "ui", "API"]);
});
