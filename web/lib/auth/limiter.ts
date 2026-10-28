/** In-memory brute-force guard: maxFailures failed logins per key within windowSeconds. */
export class LoginLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number = 5,
    private readonly windowSeconds: number = 15 * 60,
  ) {}

  private recent(key: string, now: number): number[] {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowSeconds);
    if (recent.length > 0) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  isBlocked(key: string, now: number = Date.now() / 1000): boolean {
    return this.recent(key, now).length >= this.maxFailures;
  }

  /** Seconds until the oldest counted failure expires (0 when not blocked). */
  retryAfter(key: string, now: number = Date.now() / 1000): number {
    const recent = this.recent(key, now);
    if (recent.length < this.maxFailures) return 0;
    return Math.ceil((recent[0] as number) + this.windowSeconds - now);
  }

  recordFailure(key: string, now: number = Date.now() / 1000): void {
    const recent = this.recent(key, now);
    this.failures.set(key, [...recent, now]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
