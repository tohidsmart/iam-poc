import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Eta } from "eta";
import type { FastifyReply } from "fastify";

export interface Views {
  render(reply: FastifyReply, template: string, data: Record<string, unknown>): FastifyReply;
  readonly stylesheet: string;
}

/** Templates are compiled once and auto-escape every interpolated value. */
export function createViews(directory: string): Views {
  const eta = new Eta({ views: directory, autoEscape: true, cache: true });
  return {
    stylesheet: readFileSync(join(directory, "style.css"), "utf8"),
    render(reply, template, data) {
      return reply
        .type("text/html; charset=utf-8")
        // Pages embed a CSRF token and a challenge; neither may be cached.
        .header("cache-control", "no-store")
        .send(eta.render(template, data));
    },
  };
}
