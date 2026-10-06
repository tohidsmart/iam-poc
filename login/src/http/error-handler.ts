import type { FastifyInstance } from "fastify";
import { HydraChallengeError, HydraUnavailableError } from "../ports/hydra-admin-client.js";
import type { Views } from "./views.js";

interface Problem {
  readonly status: number;
  readonly title: string;
  readonly message: string;
}

const RESTART = "Please go back to the application and start again.";

function describe(error: unknown): Problem {
  if (error instanceof HydraChallengeError) {
    return { status: 400, title: "This sign-in link is no longer valid", message: `It may have expired or already been used. ${RESTART}` };
  }
  if (error instanceof HydraUnavailableError) {
    return { status: 503, title: "Sign-in is temporarily unavailable", message: "Please try again in a moment." };
  }
  const { statusCode, validation } = error as { statusCode?: unknown; validation?: unknown };
  if (validation !== undefined) {
    return { status: 400, title: "Something was missing from that request", message: RESTART };
  }
  if (statusCode === 403) {
    return { status: 403, title: "That form has expired", message: "Go back, reload the page and try again." };
  }
  if (statusCode === 429) {
    return { status: 429, title: "Too many attempts", message: "Please wait a minute before trying again." };
  }
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return { status: statusCode, title: "That request could not be handled", message: RESTART };
  }
  return { status: 500, title: "Something went wrong", message: "Please try again in a moment." };
}

/**
 * Every failure ends in a plain page. Details go to the log, never to the
 * browser: no stack traces, no upstream messages.
 */
export function registerErrorHandling(app: FastifyInstance, views: Views): void {
  app.setErrorHandler((error, request, reply) => {
    const problem = describe(error);
    if (problem.status >= 500) request.log.error({ err: error }, "request failed");
    else request.log.info({ reason: (error as Error).name, status: problem.status }, "request refused");
    return views.render(reply.code(problem.status), "error", { ...problem });
  });

  app.setNotFoundHandler((_request, reply) =>
    views.render(reply.code(404), "error", { status: 404, title: "Page not found", message: RESTART }),
  );
}
