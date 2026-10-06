import type { FastifyRequest } from "fastify";
import type { RequestContext } from "../ports/auth-event-recorder.js";

export const contextOf = (request: FastifyRequest): RequestContext => ({ requestId: request.id, ip: request.ip });

// Hydra challenges are long opaque strings; the bounds only stop abuse.
export const challengeSchema = { type: "string", minLength: 1, maxLength: 8192 } as const;
