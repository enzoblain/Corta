import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "@/lib/config";

const GOOD = { APP_PASSWORD: "pw", SESSION_SECRET: "s".repeat(32) };

test("valid config loads with defaults", () => {
  const c = loadConfig(GOOD);
  assert.equal(c.cookieSecure, false);
  assert.equal(c.trustProxy, false);
  assert.equal(c.anthropicApiKey, "");
});

test("COOKIE_SECURE=1 enables the Secure flag", () => {
  assert.equal(loadConfig({ ...GOOD, COOKIE_SECURE: "1" }).cookieSecure, true);
});

test("refuses to start on missing or unsafe secrets", () => {
  assert.throws(() => loadConfig({}), /Missing required/);
  assert.throws(() => loadConfig({ ...GOOD, APP_PASSWORD: "change-me" }), /change-me|changed/);
  assert.throws(() => loadConfig({ ...GOOD, SESSION_SECRET: "short" }), /32 characters/);
});
