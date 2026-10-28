import { getDb } from "@/lib/db";

/** Validates the configuration and applies migrations; exits the process on failure. */
export function startup(): void {
  try {
    getDb();
  } catch (err) {
    console.error(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
