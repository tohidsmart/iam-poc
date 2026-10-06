import { describe, expect, it } from "vitest";
import { createApp } from "./support.js";

describe("health routes", () => {
  it("is live regardless of Hydra", async () => {
    const { app, hydra } = await createApp();
    hydra.ready = false;

    const response = await app.inject("/health/live");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("is ready when Hydra is ready", async () => {
    const { app } = await createApp();

    expect((await app.inject("/health/ready")).statusCode).toBe(200);
  });

  it("is not ready when Hydra is unreachable", async () => {
    const { app, hydra } = await createApp();
    hydra.ready = false;

    const response = await app.inject("/health/ready");

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable" });
  });
});
