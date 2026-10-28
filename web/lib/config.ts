import path from "node:path";

export interface Config {
  appPassword: string;
  sessionSecret: string;
  dataDir: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionTtl: number; // seconds
  anthropicApiKey: string; // server-side only; empty disables the AI
}

export type Env = Record<string, string | undefined>;

/** Reads and validates the configuration; throws when it is unsafe to start. */
export function loadConfig(env: Env = process.env): Config {
  const missing = ["APP_PASSWORD", "SESSION_SECRET"].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const appPassword = env.APP_PASSWORD as string;
  const sessionSecret = env.SESSION_SECRET as string;
  if (appPassword === "change-me") {
    throw new Error("APP_PASSWORD must be changed from the .env.example value");
  }
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return {
    appPassword,
    sessionSecret,
    dataDir: path.resolve(/*turbopackIgnore: true*/ env.DATA_DIR ?? "./data"),
    cookieSecure: env.COOKIE_SECURE === "1",
    trustProxy: env.TRUST_PROXY === "1",
    sessionTtl: 60 * 60 * 24 * 30,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}

export function dbPath(config: Config): string {
  return path.join(config.dataDir, "app.db");
}
