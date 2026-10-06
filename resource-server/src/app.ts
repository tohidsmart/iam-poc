import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { registerClientRoutes, type ApiCaller, type ClientSettings } from "./client-routes.js";
import type { TokenExchanger } from "./token-exchanger.js";
import { IntrospectionUnavailableError, type TokenInfo, type TokenIntrospector } from "./token-introspector.js";

// This package builds two separate applications that run as two containers:
// the resource server (inside the trust boundary, may ask Hydra about tokens)
// and the demo OAuth2 client (outside it, sees only Hydra's public API).

type Logger = FastifyServerOptions["logger"];

declare module "fastify" {
  interface FastifyRequest {
    token?: TokenInfo;
  }
}

function baseApp(logger: Logger): FastifyInstance {
  const app = Fastify({ logger: logger ?? false });
  app.get("/health/live", { logLevel: "warn" }, async () => ({ status: "ok" }));
  return app;
}

export interface ApiDependencies {
  readonly introspector: TokenIntrospector;
  readonly logger?: Logger;
}

/** The resource server: an API that accepts Hydra access tokens. */
export function buildApiApp(deps: ApiDependencies): FastifyInstance {
  const app = baseApp(deps.logger);

  /** Route guard: a valid access token that was granted `scope`. Responses follow RFC 6750. */
  const requireScope = (scope: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
    if (!match?.[1]) {
      return reply.code(401).header("www-authenticate", "Bearer").send({ error: "missing_token" });
    }

    let token: TokenInfo | undefined;
    try {
      token = await deps.introspector.introspect(match[1]);
    } catch (error) {
      if (!(error instanceof IntrospectionUnavailableError)) throw error;
      request.log.error({ err: error }, "cannot validate token");
      // Fail closed: if the token cannot be checked, it is not accepted.
      return reply.code(503).send({ error: "temporarily_unavailable" });
    }

    if (token === undefined) {
      return reply.code(401).header("www-authenticate", 'Bearer error="invalid_token"').send({ error: "invalid_token" });
    }
    if (!token.scopes.includes(scope)) {
      return reply
        .code(403)
        .header("www-authenticate", `Bearer error="insufficient_scope", scope="${scope}"`)
        .send({ error: "insufficient_scope", required: scope });
    }
    request.token = token;
  };

  app.get("/api/me", { preHandler: requireScope("api:read") }, async (request) => ({
    subject: request.token?.subject,
    client: request.token?.clientId,
    scopes: request.token?.scopes,
  }));

  return app;
}

export interface ClientDependencies {
  readonly tokens: TokenExchanger;
  readonly api: ApiCaller;
  readonly client: ClientSettings;
  readonly logger?: Logger;
}

/** The demo OAuth2 client: sign-in, callback and result pages. */
export async function buildClientApp(deps: ClientDependencies): Promise<FastifyInstance> {
  const app = baseApp(deps.logger);
  await registerClientRoutes(app, deps.tokens, deps.api, deps.client);
  return app;
}
