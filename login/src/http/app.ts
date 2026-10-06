import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { HydraAdminClient } from "../ports/hydra-admin-client.js";
import type { LoginService } from "../services/login-service.js";
import { registerErrorHandling } from "./error-handler.js";
import { registerHealthRoutes } from "./health-routes.js";
import { registerLoginRoutes } from "./login-routes.js";
import { createViews } from "./views.js";

export interface AppDependencies {
  readonly hydra: HydraAdminClient;
  readonly login: LoginService;
  readonly viewsDirectory: string;
  readonly cookieSecret: string;
  readonly cookieSecure: boolean;
  readonly loginAttemptsPerMinute: number;
  readonly logger?: FastifyServerOptions["logger"];
}

/** Assembles the HTTP layer from its dependencies. Does not listen. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
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

  registerErrorHandling(app, views);
  registerHealthRoutes(app, deps.hydra);
  registerLoginRoutes(app, deps.login, views, { attemptsPerMinute: deps.loginAttemptsPerMinute });

  app.get("/assets/style.css", { logLevel: "warn" }, async (_request, reply) =>
    reply.type("text/css; charset=utf-8").header("cache-control", "public, max-age=3600").send(views.stylesheet),
  );

  return app;
}
