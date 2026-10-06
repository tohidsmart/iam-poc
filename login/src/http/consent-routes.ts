import type { FastifyInstance } from "fastify";
import type { ConsentService } from "../services/consent-service.js";
import { challengeSchema, contextOf } from "./request-context.js";
import type { Views } from "./views.js";

const querySchema = {
  type: "object",
  required: ["consent_challenge"],
  properties: { consent_challenge: challengeSchema },
} as const;

const bodySchema = {
  type: "object",
  required: ["consent_challenge", "decision"],
  properties: {
    consent_challenge: challengeSchema,
    decision: { type: "string", enum: ["allow", "deny"] },
    // A single ticked box arrives as a string; Fastify coerces it to an array.
    scope: { type: "array", maxItems: 50, items: { type: "string", maxLength: 256 } },
    remember: { type: "string" },
  },
} as const;

interface ConsentQuery {
  consent_challenge: string;
}

interface ConsentBody extends ConsentQuery {
  decision: "allow" | "deny";
  scope?: string[];
  remember?: string;
}

// Plain-language text for the scopes users are most likely to see.
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected when you are not using the app",
  "api:read": "Read your data in the demo API",
};

export function registerConsentRoutes(app: FastifyInstance, consent: ConsentService, views: Views): void {
  app.get<{ Querystring: ConsentQuery }>(
    "/consent",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      const { consent_challenge } = request.query;
      const outcome = await consent.begin(consent_challenge, contextOf(request));
      if (outcome.kind === "redirect") return reply.redirect(outcome.to);
      return views.render(reply, "consent", {
        challenge: consent_challenge,
        clientName: outcome.clientName,
        scopes: outcome.requestedScopes.map((name) => ({ name, description: DESCRIPTIONS[name] ?? name })),
        csrfToken: reply.generateCsrf(),
      });
    },
  );

  app.post<{ Body: ConsentBody }>(
    "/consent",
    { schema: { body: bodySchema }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const { consent_challenge, decision, scope, remember } = request.body;
      const outcome = await consent.decide(
        consent_challenge,
        { allow: decision === "allow", scopes: scope ?? [], remember: remember !== undefined },
        contextOf(request),
      );
      // decide() always resolves the consent with Hydra, one way or the other.
      if (outcome.kind !== "redirect") throw new Error("consent decision did not produce a redirect");
      return reply.redirect(outcome.to);
    },
  );
}
