import { NextResponse } from "next/server";
import { COOKIE_NAME, cookieOptions } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", cookieOptions(0, getConfig().cookieSecure));
  return res;
}
