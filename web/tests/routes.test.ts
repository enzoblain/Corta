import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/login/route";
import { proxy } from "@/proxy";
import { getLimiter } from "@/lib/auth/runtime";
import { COOKIE_NAME, makeSession } from "@/lib/auth/session";

const SECRET = "t".repeat(32);
process.env.APP_PASSWORD = "correct horse";
process.env.SESSION_SECRET = SECRET;
process.env.COOKIE_SECURE = "1";


const loginReq = (password: unknown) =>
  new NextRequest("http://localhost/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });

beforeEach(() => getLimiter().reset("global"));

test("right password sets an httpOnly, SameSite=Lax, Secure session cookie", async () => {
  const res = await login(loginReq("correct horse"));
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Secure/i);
});

test("wrong or malformed password is refused without a cookie", async () => {
  for (const bad of ["nope", "", 42, null]) {
    const res = await login(loginReq(bad));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  }
});

test("the 6th failure is a 429, even with the right password", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login(loginReq("nope"))).status, 401);
  const blocked = await login(loginReq("correct horse"));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("a successful login resets the failure counter", async () => {
  for (let i = 0; i < 4; i++) await login(loginReq("nope"));
  assert.equal((await login(loginReq("correct horse"))).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await login(loginReq("nope"))).status, 401);
});

test("proxy: HTML pages redirect to /login, /api/* returns 401", () => {
  const page = proxy(new NextRequest("http://localhost/"));
  assert.equal(page.status, 303);
  assert.equal(new URL(page.headers.get("location") ?? "").pathname, "/login");
  assert.equal(proxy(new NextRequest("http://localhost/api/ideas")).status, 401);
});

test("proxy: public paths stay reachable", () => {
  for (const p of ["/login", "/api/login", "/healthz"]) {
    assert.equal(proxy(new NextRequest(`http://localhost${p}`)).headers.get("location"), null, p);
  }
});

test("proxy: valid session passes, forged or expired is refused", () => {
  const withCookie = (v: string) =>
    new NextRequest("http://localhost/", { headers: { cookie: `${COOKIE_NAME}=${v}` } });
  assert.equal(proxy(withCookie(makeSession(SECRET, 60))).headers.get("location"), null);
  assert.equal(proxy(withCookie(makeSession("x".repeat(32), 60))).status, 303);
  assert.equal(proxy(withCookie(makeSession(SECRET, 60, 1000))).status, 303);
});
