import type { FastifyInstance } from "fastify";
import type { LogoutService } from "../services/logout-service.js";
import { challengeSchema, contextOf } from "./request-context.js";
import type { Views } from "./views.js";

const querySchema = {
  type: "object",
  required: ["logout_challenge"],
  properties: { logout_challenge: challengeSchema },
} as const;

const bodySchema = {
  type: "object",
  required: ["logout_challenge", "decision"],
  properties: {
    logout_challenge: challengeSchema,
    decision: { type: "string", enum: ["yes", "no"] },
  },
} as const;

interface LogoutQuery {
  logout_challenge: string;
}

interface LogoutBody extends LogoutQuery {
  decision: "yes" | "no";
}

export function registerLogoutRoutes(app: FastifyInstance, logout: LogoutService, views: Views): void {
  app.get<{ Querystring: LogoutQuery }>(
    "/logout",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      const { logout_challenge } = request.query;
      await logout.begin(logout_challenge);
      return views.render(reply, "logout", { challenge: logout_challenge, csrfToken: reply.generateCsrf() });
    },
  );

  app.post<{ Body: LogoutBody }>(
    "/logout",
    { schema: { body: bodySchema }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const { logout_challenge, decision } = request.body;
      const to = await logout.decide(logout_challenge, decision === "yes", contextOf(request));
      if (to !== undefined) return reply.redirect(to);
      return views.render(reply, "error", { title: "You are still signed in", message: "You can close this page." });
    },
  );
}
