import type { AuthEvent, AuthEventRecorder, RequestContext } from "../ports/auth-event-recorder.js";

/** The one logger method this adapter needs; pino satisfies it. */
export interface InfoLogger {
  info(fields: object, message: string): void;
}

/**
 * Writes one JSON line per event to stdout, tagged `audit: true` so a log
 * pipeline can route audit records separately from application logs. The
 * timestamp is added by the logger. Passwords never reach this type.
 */
export class LogEventRecorder implements AuthEventRecorder {
  constructor(private readonly logger: InfoLogger) {}

  record(event: AuthEvent, context: RequestContext): void {
    const { type, ...details } = event;
    this.logger.info({ audit: true, event: type, ...details, reqId: context.requestId, ip: context.ip }, type);
  }
}
