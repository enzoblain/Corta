import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/healthz"]);

// Next 16 calls this file "proxy" (formerly "middleware"); it runs on the Node.js runtime.
export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const session = req.cookies.get(COOKIE_NAME)?.value;
  if (verifySession(getConfig().sessionSecret, session)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url), 303);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
