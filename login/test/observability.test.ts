import { describe, expect, it } from "vitest";
import { fanOut } from "../src/adapters/fan-out-recorder.js";
import { LogEventRecorder } from "../src/adapters/log-event-recorder.js";
import { PromMetrics } from "../src/adapters/prom-metrics.js";
import type { AuthEvent } from "../src/ports/auth-event-recorder.js";
import { createApp, ctx, openForm, postForm } from "./support.js";

const failed: AuthEvent = { type: "login.failed", username: "mallory", clientId: "demo-client", reason: "invalid_credentials" };

describe("LogEventRecorder", () => {
  it("writes one tagged line with who, what and the request it came from", () => {
    const lines: object[] = [];
    new LogEventRecorder({ info: (fields) => lines.push(fields) }).record(failed, ctx);

    expect(lines).toEqual([
      {
        audit: true,
        event: "login.failed",
        username: "mallory",
        clientId: "demo-client",
        reason: "invalid_credentials",
        reqId: "req-test",
        ip: "203.0.113.7",
      },
    ]);
  });
});

describe("fanOut", () => {
  it("keeps recording when one recorder throws", () => {
    const seen: string[] = [];
    const recorder = fanOut(
      { record: () => { throw new Error("disk full"); } },
      { record: (event) => seen.push(event.type) },
    );

    expect(() => recorder.record(failed, ctx)).not.toThrow();
    expect(seen).toEqual(["login.failed"]);
  });
});

describe("PromMetrics", () => {
  it("counts events and times Hydra calls", async () => {
    const metrics = new PromMetrics({ defaultMetrics: false });
    metrics.record(failed);
    metrics.record(failed);
    metrics.observeHydraCall("login.get", true, 0.02);

    const text = await metrics.render();

    expect(text).toContain('auth_events_total{event="login.failed"} 2');
    expect(text).toContain('hydra_admin_request_duration_seconds_count{operation="login.get",outcome="ok"} 1');
  });
});

describe("GET /metrics", () => {
  it("reports requests by route pattern, not by URL", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app, "/login?login_challenge=challenge-1");
    await postForm(app, "/login", [["_csrf", token], ["login_challenge", "challenge-1"], ["username", "alice"], ["password", "nope"]], cookie);

    const response = await app.inject("/metrics");

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('http_request_duration_seconds_count{method="POST",route="/login",status="401"} 1');
    expect(response.body).not.toContain("challenge-1");
  });
});
