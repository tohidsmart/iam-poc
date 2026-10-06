import { describe, expect, it } from "vitest";
import { buildApiApp } from "../src/app.js";
import { HydraIntrospector } from "../src/hydra-introspector.js";
import { IntrospectionUnavailableError, type TokenInfo } from "../src/token-introspector.js";

const appWith = (tokens: Record<string, TokenInfo>, down = false) =>
  buildApiApp({
    introspector: {
      introspect: async (token) => {
        if (down) throw new IntrospectionUnavailableError("down");
        return tokens[token];
      },
    },
  });

const get = (app: ReturnType<typeof appWith>, authorization?: string) =>
  app.inject({ url: "/api/me", headers: authorization ? { authorization } : {} });

const alice: TokenInfo = { subject: "user-alice", clientId: "demo-app", scopes: ["openid", "api:read"] };

describe("GET /api/me", () => {
  it("returns the caller for a valid token with the required scope", async () => {
    const response = await get(appWith({ good: alice }), "Bearer good");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ subject: "user-alice", client: "demo-app", scopes: ["openid", "api:read"] });
  });

  it("answers 401 without a bearer token", async () => {
    const response = await get(appWith({}));

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  });

  it("answers 401 for an unknown, expired or revoked token", async () => {
    const response = await get(appWith({ good: alice }), "Bearer stale");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("answers 403 when the token lacks the scope", async () => {
    const response = await get(appWith({ weak: { ...alice, scopes: ["openid"] } }), "Bearer weak");

    expect(response.statusCode).toBe(403);
    expect(response.headers["www-authenticate"]).toContain('scope="api:read"');
  });

  it("fails closed when the token cannot be checked", async () => {
    expect((await get(appWith({ good: alice }, true), "Bearer good")).statusCode).toBe(503);
  });
});

describe("HydraIntrospector", () => {
  const introspectorReturning = (body: unknown, status = 200) =>
    new HydraIntrospector({
      adminUrl: "http://hydra:4445/",
      timeoutMs: 50,
      fetch: async () => new Response(JSON.stringify(body), { status }),
    });

  it("maps an active access token", async () => {
    const info = await introspectorReturning({
      active: true,
      token_use: "access_token",
      sub: "user-alice",
      client_id: "demo-app",
      scope: "openid api:read",
    }).introspect("t");

    expect(info).toEqual(alice);
  });

  it("rejects inactive tokens and refresh tokens", async () => {
    expect(await introspectorReturning({ active: false }).introspect("t")).toBeUndefined();
    expect(
      await introspectorReturning({ active: true, token_use: "refresh_token", sub: "u", client_id: "c" }).introspect("t"),
    ).toBeUndefined();
  });

  it("reports a Hydra failure as unavailable, not as an invalid token", async () => {
    await expect(introspectorReturning({}, 500).introspect("t")).rejects.toBeInstanceOf(IntrospectionUnavailableError);
  });
});
