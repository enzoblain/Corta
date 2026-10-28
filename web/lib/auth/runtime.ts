import type { NextRequest } from "next/server";
import { LoginLimiter } from "@/lib/auth/limiter";
import type { Config } from "@/lib/config";

const globalForAuth = globalThis as unknown as { __limiter?: LoginLimiter };

export function getLimiter(): LoginLimiter {
  globalForAuth.__limiter ??= new LoginLimiter();
  return globalForAuth.__limiter;
}

/**
 * Limiter key. Without a trusted reverse proxy the client IP cannot be known
 * (X-Forwarded-For is spoofable), so a single global bucket is used: this is a
 * single-user app. With TRUST_PROXY=1 the first X-Forwarded-For entry is used.
 */
export function limiterKey(req: NextRequest, config: Config): string {
  if (!config.trustProxy) return "global";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "global";
}
