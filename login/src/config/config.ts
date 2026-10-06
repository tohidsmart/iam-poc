import { readFileSync } from "node:fs";
import { z } from "zod";

const schema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  hydraAdminUrl: z.string().url(),
  hydraTimeoutMs: z.coerce.number().int().positive().default(5000),
  cookieSecret: z.string().min(32, "must be at least 32 characters"),
});

export type Config = Readonly<z.infer<typeof schema>>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;
type ReadFile = (path: string) => string;

/**
 * Reads a secret from `${name}_FILE` (a mounted secret) or, failing that, from
 * `${name}`. Files win so that a secret never has to sit in the environment,
 * where it shows up in `docker inspect` and in child processes.
 */
function readSecret(env: Env, name: string, readFile: ReadFile): string | undefined {
  const path = env[`${name}_FILE`];
  if (path === undefined) return env[name];
  try {
    return readFile(path).trim();
  } catch {
    throw new ConfigError(`${name}_FILE: cannot read ${path}`);
  }
}

/** Builds the config once at start-up and fails fast, naming every bad key. */
export function loadConfig(
  env: Env = process.env,
  readFile: ReadFile = (path) => readFileSync(path, "utf8"),
): Config {
  const parsed = schema.safeParse({
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    hydraAdminUrl: env.HYDRA_ADMIN_URL,
    hydraTimeoutMs: env.HYDRA_TIMEOUT_MS,
    cookieSecret: readSecret(env, "COOKIE_SECRET", readFile),
  });
  if (!parsed.success) {
    // Zod reports the key and the rule, never the offending value.
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`invalid configuration: ${problems.join("; ")}`);
  }
  return Object.freeze(parsed.data);
}
