import { describe, expect, it } from "vitest";
import { HydraHttpClient } from "../src/adapters/hydra-http-client.js";

const clientWith = (fetch: typeof globalThis.fetch) =>
  new HydraHttpClient({ baseUrl: "http://hydra:4445/", timeoutMs: 50, fetch });

describe("HydraHttpClient.isReady", () => {
  it("calls the admin readiness endpoint", async () => {
    const urls: string[] = [];
    const client = clientWith(async (input) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    });

    expect(await client.isReady()).toBe(true);
    expect(urls).toEqual(["http://hydra:4445/health/ready"]);
  });

  it("is false on a non-2xx response", async () => {
    expect(await clientWith(async () => new Response("", { status: 503 })).isReady()).toBe(false);
  });

  it("is false when the request fails", async () => {
    const client = clientWith(async () => {
      throw new TypeError("fetch failed");
    });

    expect(await client.isReady()).toBe(false);
  });
});
