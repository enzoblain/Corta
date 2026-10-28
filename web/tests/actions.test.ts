import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertSession } from "@/lib/auth/require";
import { makeSession } from "@/lib/auth/session";

process.env.APP_PASSWORD = "correct horse";
process.env.SESSION_SECRET = "t".repeat(32);
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "corta-actions-"));

test("every Server Action fails before touching the database when called outside a valid request", async () => {
  const actions = await import("@/app/actions");
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO projects (name) VALUES ('Maison')").run();
  db.prepare("INSERT INTO ideas (raw_text, title, status) VALUES ('brut', 'Idée', 'todo')").run();
  const snapshot = (): string =>
    JSON.stringify([
      db.prepare("SELECT * FROM projects").all(),
      db.prepare("SELECT * FROM ideas").all(),
      db.prepare("SELECT * FROM tags").all(),
    ]);
  const before = snapshot();

  const form = new FormData();
  form.set("id", "1");
  form.set("name", "Hacked");
  form.set("title", "Hacked");
  form.set("status", "done");
  const prev = { error: "" };

  await assert.rejects(actions.createProjectAction(prev, form), /Unauthorized|request scope/);
  await assert.rejects(actions.renameProjectAction(prev, form), /Unauthorized|request scope/);
  await assert.rejects(actions.deleteProjectAction(form), /Unauthorized|request scope/);
  await assert.rejects(actions.saveIdeaAction(prev, form), /Unauthorized|request scope/);
  await assert.rejects(actions.setStatusAction(1, "done"), /Unauthorized|request scope/);
  assert.equal(snapshot(), before);
});

test("assertSession refuses missing, empty, forged and expired cookies, accepts a valid one", () => {
  const secret = "t".repeat(32);
  const past = Math.floor(Date.now() / 1000) - 7200;
  for (const bad of [
    undefined,
    "",
    "garbage",
    makeSession("o".repeat(32), 3600),
    makeSession(secret, 3600, past),
  ]) {
    assert.throws(() => assertSession(secret, bad), /Unauthorized/);
  }
  assert.doesNotThrow(() => assertSession(secret, makeSession(secret, 3600)));
});
