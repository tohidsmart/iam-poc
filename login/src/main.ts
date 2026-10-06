import { HydraHttpClient } from "./adapters/hydra-http-client.js";
import { ConfigError, loadConfig, type Config } from "./config/config.js";
import { buildApp } from "./http/app.js";

// Composition root: the only module that constructs adapters and reads the
// process environment. Everything else receives what it needs.
function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

const config = loadConfigOrExit();

const hydra = new HydraHttpClient({
  baseUrl: config.hydraAdminUrl,
  timeoutMs: config.hydraTimeoutMs,
});

const app = buildApp({ hydra, logger: { level: config.logLevel } });

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

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal(error, "failed to start");
  process.exit(1);
}
