import type { FastifyInstance, FastifyReply } from "fastify";
import type { LoginOutcome, LoginService } from "../services/login-service.js";
import { challengeSchema, contextOf } from "./request-context.js";
import type { Views } from "./views.js";

const challenge = challengeSchema;

const querySchema = {
  type: "object",
  required: ["login_challenge"],
  properties: { login_challenge: challenge },
} as const;

const bodySchema = {
  type: "object",
  required: ["login_challenge", "username", "password"],
  properties: {
    login_challenge: challenge,
    username: { type: "string", minLength: 1, maxLength: 254 },
    // Capped so a huge password cannot be used to burn CPU in the hasher.
    password: { type: "string", minLength: 1, maxLength: 1024 },
    remember: { type: "string" },
  },
} as const;

interface LoginQuery {
  login_challenge: string;
}

interface LoginBody extends LoginQuery {
  username: string;
  password: string;
  remember?: string;
}

export interface LoginRouteOptions {
  readonly attemptsPerMinute: number;
}

export function registerLoginRoutes(
  app: FastifyInstance,
  login: LoginService,
  views: Views,
  options: LoginRouteOptions,
): void {
  const respond = (
    reply: FastifyReply,
    outcome: LoginOutcome,
    form: { challenge: string; username?: string; failed?: boolean },
  ): FastifyReply => {
    if (outcome.kind === "redirect") return reply.redirect(outcome.to);
    return views.render(reply.code(form.failed ? 401 : 200), "login", {
      challenge: form.challenge,
      clientName: outcome.clientName,
      username: form.username ?? "",
      // One message for every failure: never reveal whether the username exists.
      error: form.failed ? "The username or password is incorrect." : undefined,
      csrfToken: reply.generateCsrf(),
    });
  };

  app.get<{ Querystring: LoginQuery }>("/login", { schema: { querystring: querySchema } }, async (request, reply) => {
    const { login_challenge } = request.query;
    return respond(reply, await login.begin(login_challenge, contextOf(request)), { challenge: login_challenge });
  });

  app.post<{ Body: LoginBody }>(
    "/login",
    {
      schema: { body: bodySchema },
      // preHandler, not onRequest: the token is in the form body, which must be parsed first.
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: options.attemptsPerMinute, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { login_challenge, username, password, remember } = request.body;
      const outcome = await login.submit(
        login_challenge,
        { username, password, remember: remember !== undefined },
        contextOf(request),
      );
      return respond(reply, outcome, { challenge: login_challenge, username, failed: true });
    },
  );
}
