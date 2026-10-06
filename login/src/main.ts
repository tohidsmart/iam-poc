import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Argon2Hasher } from "./adapters/argon2-hasher.js";
import { FileUserRepository } from "./adapters/file-user-repository.js";
import { HydraHttpClient } from "./adapters/hydra-http-client.js";
import { loadConfig } from "./config/config.js";
import { buildApp } from "./http/app.js";
import { loggerOptions } from "./http/logging.js";
import { LoginService } from "./services/login-service.js";

// Composition root: the only module that constructs adapters and reads the
// process environment. Everything else receives what it needs.
async function start(): Promise<void> {
  const config = loadConfig();

  const hydra = new HydraHttpClient({ baseUrl: config.hydraAdminUrl, timeoutMs: config.hydraTimeoutMs });
  const users = FileUserRepository.fromFile(config.usersFile);
  const hasher = new Argon2Hasher();

  const login = new LoginService(hydra, users, hasher, {
    rememberForSeconds: config.rememberForSeconds,
    dummyHash: await hasher.hash(randomBytes(32).toString("hex")),
  });

  const app = await buildApp({
    hydra,
    login,
    // views/ sits beside src/ in development and beside dist/ in the image.
    viewsDirectory: join(import.meta.dirname, "..", "views"),
    cookieSecret: config.cookieSecret,
    cookieSecure: config.cookieSecure,
    loginAttemptsPerMinute: config.loginAttemptsPerMinute,
    logger: loggerOptions(config.logLevel),
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, "shutting down");
      // close() stops accepting connections and waits for in-flight requests.
      app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error(error, "shutdown failed");
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

start().catch((error: unknown) => {
  // Start-up failures (bad config, unreadable users file, port in use) are
  // reported in one line and never include secret values.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
});
