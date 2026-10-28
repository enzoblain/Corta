import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { AIError, type Suggestion } from "@/lib/ai";
import { captureConfirm, captureReprocess, captureSuggest, type ConfirmInput } from "@/lib/capture";
import { connect, migrate, type Db } from "@/lib/db";

let db: Db;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corta-capture-"));
  db = connect(path.join(dir, "app.db"));
  migrate(db);
  db.prepare("INSERT INTO projects (name) VALUES ('Maison')").run();
});

const rows = (sql: string): unknown[][] => db.prepare(sql).raw().all() as unknown[][];

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  title: "T",
  content: "C",
  projectId: null,
  newProject: "Jardin",
  tags: ["a"],
  ...over,
});
const failing = async (): Promise<Suggestion> => {
  throw new AIError("boom");
};
const warnQuiet = (): void => {
  console.warn = () => undefined;
};

const confirmInput = (over: Partial<ConfirmInput> = {}): ConfirmInput => ({
  rawText: "raw",
  ideaId: null,
  title: "T",
  content: "C",
  tags: "a",
  projectChoice: "",
  newProject: "",
  ...over,
});

test("AI failure keeps the raw idea in the Inbox", async () => {
  warnQuiet();
  const res = await captureSuggest(db, "key", "une idée", failing);
  assert.deepEqual(res, { kind: "inbox", notice: "ai_error" });
  assert.deepEqual(rows("SELECT raw_text, project_id, ai_processed FROM ideas"), [["une idée", null, 0]]);
});

test("missing key goes to the Inbox with its own notice", async () => {
  warnQuiet();
  const res = await captureSuggest(db, "", "x", failing);
  assert.deepEqual(res, { kind: "inbox", notice: "no_key" });
});

test("successful suggest stores nothing", async () => {
  const res = await captureSuggest(db, "key", "une idée", async () => suggestion());
  assert.equal(res.kind, "suggestion");
  assert.deepEqual(rows("SELECT * FROM ideas"), []);
  assert.equal(rows("SELECT * FROM projects").length, 1);
});

test("empty input is ignored", async () => {
  assert.deepEqual(await captureSuggest(db, "key", "   ", failing), { kind: "ignored" });
  assert.deepEqual(rows("SELECT * FROM ideas"), []);
});

test("confirm with an existing project ignores the new project field", () => {
  const res = captureConfirm(db, confirmInput({ projectChoice: "1", newProject: "Jardin" }));
  assert.deepEqual(res, { ok: true, inbox: false });
  assert.deepEqual(rows("SELECT name FROM projects"), [["Maison"]]);
  assert.deepEqual(rows("SELECT project_id, ai_processed FROM ideas"), [[1, 1]]);
});

test("confirm with a new project creates it once, case-insensitively", () => {
  captureConfirm(db, confirmInput({ projectChoice: "new", newProject: "Jardin" }));
  captureConfirm(db, confirmInput({ projectChoice: "new", newProject: "jardin" }));
  assert.equal(rows("SELECT * FROM projects").length, 2);
  assert.deepEqual(rows("SELECT DISTINCT project_id FROM ideas"), [[2]]);
});

test("confirm with an unknown project is rejected and stores nothing", () => {
  const res = captureConfirm(db, confirmInput({ projectChoice: "999" }));
  assert.equal(res.ok, false);
  assert.deepEqual(rows("SELECT * FROM ideas"), []);
});

test("confirm requires title, content and a tag", () => {
  for (const over of [{ title: " " }, { content: "" }, { tags: " , #" }]) {
    assert.equal(captureConfirm(db, confirmInput(over)).ok, false);
  }
  assert.deepEqual(rows("SELECT * FROM ideas"), []);
});

test("reprocess then confirm updates the same row", async () => {
  warnQuiet();
  await captureSuggest(db, "key", "une idée", failing);
  const res = await captureReprocess(db, "key", 1, async () => suggestion({ projectId: 1, newProject: "" }));
  assert.equal(res.kind, "suggestion");
  captureConfirm(db, confirmInput({ ideaId: 1, projectChoice: "1" }));
  assert.deepEqual(
    rows("SELECT id, raw_text, title, project_id, ai_processed FROM ideas"),
    [[1, "une idée", "T", 1, 1]],
  );
});

test("reprocess failure leaves the idea untouched; unknown or filed ideas are ignored", async () => {
  warnQuiet();
  await captureSuggest(db, "key", "une idée", failing);
  assert.deepEqual(await captureReprocess(db, "key", 1, failing), { kind: "inbox", notice: "reprocess_error" });
  assert.deepEqual(await captureReprocess(db, "key", 42, failing), { kind: "ignored" });
  captureConfirm(db, confirmInput({ ideaId: 1, projectChoice: "1" }));
  assert.deepEqual(await captureReprocess(db, "key", 1, failing), { kind: "ignored" });
});

test("confirm refuses to rewrite an idea that left the Inbox", () => {
  const id = Number(db.prepare("INSERT INTO ideas (raw_text, project_id) VALUES ('x', 1)").run().lastInsertRowid);
  assert.equal(captureConfirm(db, confirmInput({ ideaId: id })).ok, false);
  assert.deepEqual(rows("SELECT title, ai_processed FROM ideas"), [[null, 0]]);
});
