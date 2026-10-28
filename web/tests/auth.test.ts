import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword } from "@/lib/auth/password";
import type { NextRequest } from "next/server";
import { limiterKey } from "@/lib/auth/runtime";
import type { Config } from "@/lib/config";
import { LoginLimiter } from "@/lib/auth/limiter";
import { makeSession, verifySession } from "@/lib/auth/session";

const SECRET = "s".repeat(32);

test("checkPassword accepts the right password only", () => {
  assert.equal(checkPassword("hunter2", "hunter2"), true);
  assert.equal(checkPassword("hunter3", "hunter2"), false);
  assert.equal(checkPassword("", "hunter2"), false);
  assert.equal(checkPassword("hunter2-and-more", "hunter2"), false);
});

test("a fresh session verifies", () => {
  assert.equal(verifySession(SECRET, makeSession(SECRET, 60, 1000), 1010), true);
});

test("a session expires", () => {
  const value = makeSession(SECRET, 60, 1000);
  assert.equal(verifySession(SECRET, value, 1059), true);
  assert.equal(verifySession(SECRET, value, 1060), false);
});

test("a tampered or foreign session is rejected", () => {
  const value = makeSession(SECRET, 60, 1000);
  const [expires, sig] = value.split(".") as [string, string];
  assert.equal(verifySession(SECRET, `${Number(expires) + 1000}.${sig}`, 1010), false);
  assert.equal(verifySession(SECRET, `${expires}.${"0".repeat(sig.length)}`, 1010), false);
  assert.equal(verifySession("o".repeat(32), value, 1010), false);
});

test("malformed sessions are rejected", () => {
  for (const bad of [undefined, "", "nodot", ".", "abc.def", "12.", ".sig"]) {
    assert.equal(verifySession(SECRET, bad, 1010), false, String(bad));
  }
});

test("limiter blocks after 5 failures and recovers after the window", () => {
  const l = new LoginLimiter(5, 900);
  for (let i = 0; i < 4; i++) l.recordFailure("ip", 100 + i);
  assert.equal(l.isBlocked("ip", 110), false);
  l.recordFailure("ip", 104);
  assert.equal(l.isBlocked("ip", 110), true);
  assert.equal(l.isBlocked("other", 110), false);
  assert.equal(l.retryAfter("ip", 110), 890);
  assert.equal(l.isBlocked("ip", 100 + 900), false);
});

test("limiter reset clears the failures", () => {
  const l = new LoginLimiter(2, 900);
  l.recordFailure("ip", 1);
  l.recordFailure("ip", 2);
  assert.equal(l.isBlocked("ip", 3), true);
  l.reset("ip");
  assert.equal(l.isBlocked("ip", 3), false);
});

test("limiterKey with TRUST_PROXY uses the last X-Forwarded-For entry", () => {
  const config = { trustProxy: true } as Config;
  const req = (xff: string): NextRequest =>
    ({ headers: new Headers({ "x-forwarded-for": xff }) }) as unknown as NextRequest;
  assert.equal(limiterKey(req("10.0.0.1, 203.0.113.9"), config), "203.0.113.9");
  assert.equal(limiterKey(req("10.0.7.7, 203.0.113.9"), config), "203.0.113.9");
  assert.equal(limiterKey(req("10.0.0.1"), { trustProxy: false } as Config), "global");
});

test("limiter purges expired keys once the map is large", () => {
  const limiter = new LoginLimiter(5, 10);
  for (let i = 0; i < 1001; i++) limiter.recordFailure(`k${i}`, 0);
  limiter.recordFailure("late", 100);
  assert.equal((limiter as unknown as { failures: Map<string, number[]> }).failures.size, 1);
});
