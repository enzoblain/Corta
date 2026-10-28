import { NextResponse, type NextRequest } from "next/server";
import { checkPassword } from "@/lib/auth/password";
import { getLimiter, limiterKey } from "@/lib/auth/runtime";
import { COOKIE_NAME, cookieOptions, makeSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const limiter = getLimiter();
  const key = limiterKey(req, config);

  if (limiter.isBlocked(key)) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfter(key)) } },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const password =
    typeof body === "object" && body !== null && "password" in body
      ? (body as { password: unknown }).password
      : undefined;

  if (typeof password !== "string" || !checkPassword(password, config.appPassword)) {
    limiter.recordFailure(key);
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  limiter.reset(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    makeSession(config.sessionSecret, config.sessionTtl),
    cookieOptions(config.sessionTtl, config.cookieSecure),
  );
  return res;
}
