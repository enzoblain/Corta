import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

/** Throws `Unauthorized` unless `cookieValue` is a valid, unexpired session cookie. */
export function assertSession(secret: string, cookieValue: string | undefined): void {
  if (!verifySession(secret, cookieValue)) throw new Error("Unauthorized");
}

/**
 * Defense in depth for Server Actions: they are public POST endpoints, so each one
 * checks the session itself instead of relying on the proxy. Fails closed, also when
 * called outside a request (`cookies()` throws).
 */
export async function requireSession(): Promise<void> {
  assertSession(getConfig().sessionSecret, (await cookies()).get(COOKIE_NAME)?.value);
}
