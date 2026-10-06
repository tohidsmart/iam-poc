import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import type { HydraAdminClient } from "../src/ports/hydra-admin-client.js";

const hydraThatIs = (ready: boolean): HydraAdminClient => ({ isReady: async () => ready });

describe("health routes", () => {
  it("is live regardless of Hydra", async () => {
    const response = await buildApp({ hydra: hydraThatIs(false) }).inject("/health/live");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("is ready when Hydra is ready", async () => {
    const response = await buildApp({ hydra: hydraThatIs(true) }).inject("/health/ready");

    expect(response.statusCode).toBe(200);
  });

  it("is not ready when Hydra is unreachable", async () => {
    const response = await buildApp({ hydra: hydraThatIs(false) }).inject("/health/ready");

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable" });
  });
});
