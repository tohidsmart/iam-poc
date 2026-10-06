import type { LoggerOptions } from "pino";

/**
 * Request logs carry the path only. The query string holds the login or
 * consent challenge, which identifies an in-progress sign-in and does not
 * belong in log storage.
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    serializers: {
      req: (request: { method: string; url: string; ip: string }) => ({
        method: request.method,
        path: request.url.split("?", 1)[0],
        remoteAddress: request.ip,
      }),
    },
  };
}
