// Fail fast at startup (without the exit, Next keeps serving 500s on an unsafe configuration).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startup } = await import("@/lib/startup");
  startup();
}
