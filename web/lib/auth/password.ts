import { createHash, timingSafeEqual } from "node:crypto";

/** Compares sha256 digests so length differences don't leak and the compare is constant time. */
export function checkPassword(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
