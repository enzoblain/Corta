import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "session";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Cookie value: `<expiry>.<hmac(expiry)>`. */
export function makeSession(secret: string, ttl: number, now: number = nowSeconds()): string {
  const expires = String(Math.floor(now + ttl));
  return `${expires}.${sign(secret, expires)}`;
}

export function verifySession(
  secret: string,
  value: string | undefined,
  now: number = nowSeconds(),
): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const expires = value.slice(0, dot);
  const sig = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(secret, expires));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;
  return /^\d+$/.test(expires) && Number(expires) > now;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export function cookieOptions(maxAge: number, secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge };
}
