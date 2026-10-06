import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import type { AuthEvent, AuthEventRecorder } from "../ports/auth-event-recorder.js";

/** Prometheus metrics. Rates (requests per second) are derived from the counters by the scraper. */
export class PromMetrics implements AuthEventRecorder {
  private readonly registry = new Registry();
  private readonly events: Counter<"event">;
  private readonly http: Histogram<"method" | "route" | "status">;
  private readonly hydra: Histogram<"operation" | "outcome">;

  readonly contentType = this.registry.contentType;

  constructor(options: { defaultMetrics?: boolean } = {}) {
    if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });
    this.events = new Counter({
      name: "auth_events_total",
      help: "Login, consent and logout outcomes.",
      labelNames: ["event"],
      registers: [this.registry],
    });
    this.http = new Histogram({
      name: "http_request_duration_seconds",
      help: "Duration of HTTP requests served.",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry],
    });
    this.hydra = new Histogram({
      name: "hydra_admin_request_duration_seconds",
      help: "Duration of calls to the Hydra admin API.",
      labelNames: ["operation", "outcome"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
      registers: [this.registry],
    });
  }

  record(event: AuthEvent): void {
    this.events.inc({ event: event.type });
  }

  /** `route` must be the route pattern, never the raw URL, to keep label values bounded. */
  observeHttp(method: string, route: string, status: number, seconds: number): void {
    this.http.observe({ method, route, status: String(status) }, seconds);
  }

  observeHydraCall(operation: string, ok: boolean, seconds: number): void {
    this.hydra.observe({ operation, outcome: ok ? "ok" : "error" }, seconds);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
