import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { HydraAdminClient } from "../ports/hydra-admin-client.js";
import { registerHealthRoutes } from "./health-routes.js";

export interface AppDependencies {
  readonly hydra: HydraAdminClient;
  readonly logger?: FastifyServerOptions["logger"];
}

/** Assembles the HTTP layer from its dependencies. Does not listen. */
export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  registerHealthRoutes(app, deps.hydra);

  return app;
}
