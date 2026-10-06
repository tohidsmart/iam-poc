import type { FastifyInstance } from "fastify";
import type { HydraHealth } from "../ports/hydra-admin-client.js";

/**
 * Liveness says the process can answer; readiness says it can do useful work,
 * which here means reaching Hydra. An orchestrator restarts on the first and
 * only stops routing traffic on the second.
 */
export function registerHealthRoutes(app: FastifyInstance, hydra: HydraHealth): void {
  app.get("/health/live", { logLevel: "warn" }, async () => ({ status: "ok" }));

  app.get("/health/ready", { logLevel: "warn" }, async (_request, reply) => {
    if (await hydra.isReady()) return { status: "ok" };
    return reply.code(503).send({ status: "unavailable", reason: "hydra admin API not ready" });
  });
}
