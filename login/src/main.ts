import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pino } from "pino";
import { Argon2Hasher } from "./adapters/argon2-hasher.js";
import { fanOut } from "./adapters/fan-out-recorder.js";
import { FileUserRepository } from "./adapters/file-user-repository.js";
import { HydraHttpClient } from "./adapters/hydra-http-client.js";
import { LogEventRecorder } from "./adapters/log-event-recorder.js";
import { PromMetrics } from "./adapters/prom-metrics.js";
import { loadConfig } from "./config/config.js";
import { buildApp } from "./http/app.js";
import { loggerOptions } from "./http/logging.js";
import { ConsentService } from "./services/consent-service.js";
import { LoginService } from "./services/login-service.js";
import { LogoutService } from "./services/logout-service.js";

// Composition root: the only module that constructs adapters and reads the
// process environment. Everything else receives what it needs.
async function start(): Promise<void> {
  const config = loadConfig();
  const logger = pino(loggerOptions(config.logLevel));

  const metrics = new PromMetrics();
  const events = fanOut(new LogEventRecorder(logger), metrics);
  const hydra = new HydraHttpClient({
    baseUrl: config.hydraAdminUrl,
    timeoutMs: config.hydraTimeoutMs,
    onCall: (operation, ok, seconds) => metrics.observeHydraCall(operation, ok, seconds),
  });
  const users = FileUserRepository.fromFile(config.usersFile);
  const hasher = new Argon2Hasher();

  const login = new LoginService(hydra, users, hasher, events, {
    rememberForSeconds: config.rememberForSeconds,
    dummyHash: await hasher.hash(randomBytes(32).toString("hex")),
  });
  const consent = new ConsentService(hydra, users, events, { rememberForSeconds: config.rememberForSeconds });
  const logout = new LogoutService(hydra, events);

  const app = await buildApp({
    hydra,
    login,
    consent,
    logout,
    metrics,
    // views/ sits beside src/ in development and beside dist/ in the image.
    viewsDirectory: join(import.meta.dirname, "..", "views"),
    cookieSecret: config.cookieSecret,
    cookieSecure: config.cookieSecure,
    loginAttemptsPerMinute: config.loginAttemptsPerMinute,
    logger,
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
