import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { HydraHealth } from "../ports/hydra-admin-client.js";
import type { ConsentService } from "../services/consent-service.js";
import type { LoginService } from "../services/login-service.js";
import type { LogoutService } from "../services/logout-service.js";
import { registerConsentRoutes } from "./consent-routes.js";
import { registerErrorHandling } from "./error-handler.js";
import { registerHealthRoutes } from "./health-routes.js";
import { registerLoginRoutes } from "./login-routes.js";
import { registerLogoutRoutes } from "./logout-routes.js";
import { createViews } from "./views.js";

/** What the HTTP layer needs from a metrics backend. */
export interface HttpMetrics {
  readonly contentType: string;
  observeHttp(method: string, route: string, status: number, seconds: number): void;
  render(): Promise<string>;
}

export interface AppDependencies {
  readonly hydra: HydraHealth;
  readonly login: LoginService;
  readonly consent: ConsentService;
  readonly logout: LogoutService;
  readonly metrics: HttpMetrics;
  readonly viewsDirectory: string;
  readonly cookieSecret: string;
  readonly cookieSecure: boolean;
  readonly loginAttemptsPerMinute: number;
  readonly logger?: FastifyBaseLogger;
}

/** Assembles the HTTP layer from its dependencies. Does not listen. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app: FastifyInstance = deps.logger ? Fastify({ loggerInstance: deps.logger }) : Fastify();
  const views = createViews(deps.viewsDirectory);

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      // No scripts at all, one same-origin stylesheet, no framing.
      // form-action is deliberately absent: browsers apply it to the whole
      // redirect chain after a form post, and that chain ends at the OAuth2
      // client's redirect URI, which this service cannot know in advance.
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(formbody);
  await app.register(cookie, { secret: deps.cookieSecret });
  // Double-submit CSRF: a signed cookie holds a secret, the form carries a
  // token derived from it. No server-side session, so any replica can verify.
  await app.register(csrf, {
    cookieOpts: { signed: true, httpOnly: true, sameSite: "strict", path: "/", secure: deps.cookieSecure },
  });
  // In-memory counters: each replica counts separately. See README for the
  // shared-store alternative.
  await app.register(rateLimit, { global: false });

  app.addHook("onResponse", async (request, reply) => {
    // The route pattern, not the URL: unmatched paths share one label value.
    const route = request.routeOptions.url ?? "unmatched";
    deps.metrics.observeHttp(request.method, route, reply.statusCode, reply.elapsedTime / 1000);
  });

  registerErrorHandling(app, views);
  registerHealthRoutes(app, deps.hydra);
  registerLoginRoutes(app, deps.login, views, { attemptsPerMinute: deps.loginAttemptsPerMinute });
  registerConsentRoutes(app, deps.consent, views);
  registerLogoutRoutes(app, deps.logout, views);

  app.get("/assets/style.css", { logLevel: "warn" }, async (_request, reply) =>
    reply.type("text/css; charset=utf-8").header("cache-control", "public, max-age=3600").send(views.stylesheet),
  );

  // Served on the main port for the POC. In production this belongs on an
  // internal-only listener, since it describes traffic and failure rates.
  app.get("/metrics", { logLevel: "warn" }, async (_request, reply) =>
    reply.type(deps.metrics.contentType).send(await deps.metrics.render()),
  );

  return app;
}
