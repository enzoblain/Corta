import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

/**
 * Defense in depth for Server Actions: they are public POST endpoints, so each one
 * checks the session itself instead of relying on the proxy. Throws when the session
 * is missing, invalid or expired (and when called outside a request: fail closed).
 */
export async function requireSession(): Promise<void> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!verifySession(getConfig().sessionSecret, value)) throw new Error("Unauthorized");
}
