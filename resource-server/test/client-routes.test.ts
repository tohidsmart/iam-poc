import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { TokenExchangeError, type TokenSet } from "../src/token-exchanger.js";
import { HttpApiCaller } from "../src/client-routes.js";
import { createClientApp as createApp } from "./support.js";

const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

const tokenSet: TokenSet = {
  accessToken: "ory_at_demo",
  idToken: idToken({ sub: "user-alice", name: "<Alice>" }),
  refreshToken: undefined,
  scope: "openid profile",
  expiresIn: 3600,
};

/** Starts a flow and returns what the browser would hold afterwards. */
async function signIn(app: FastifyInstance) {
  const response = await app.inject("/signin");
  const authorize = new URL(String(response.headers.location));
  const cookie = String(response.headers["set-cookie"]).split(";", 1)[0] ?? "";
  return { authorize, cookie, state: authorize.searchParams.get("state") ?? "" };
}

describe("GET /signin", () => {
  it("redirects to Hydra with state and a PKCE challenge, keeping the verifier in a cookie", async () => {
    const app = await createApp();

    const response = await app.inject("/signin");
    const { authorize, cookie } = await signIn(app);

    expect(response.statusCode).toBe(302);
    expect(authorize.origin + authorize.pathname).toBe("http://hydra.browser/oauth2/auth");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "demo-app",
      response_type: "code",
      scope: "openid profile api:read",
      redirect_uri: "http://app.test/callback",
      code_challenge_method: "S256",
    });
    const flow = JSON.parse(decodeURIComponent(cookie.split("=")[1] ?? "")) as { verifier: string };
    expect(authorize.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(flow.verifier).digest("base64url"),
    );
    expect(authorize.toString()).not.toContain(flow.verifier);
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
  });
});

describe("GET /callback", () => {
  it("exchanges the code with the stored verifier and shows scopes, claims and the API result", async () => {
    const exchanged: Array<[string, string]> = [];
    const apiCalls: string[] = [];
    const app = await createApp({
      tokens: {
        exchange: async (code, verifier) => {
          exchanged.push([code, verifier]);
          return tokenSet;
        },
      },
      api: {
        getMe: async (accessToken) => {
          apiCalls.push(accessToken);
          return { status: 403, body: '{"error":"insufficient_scope","required":"api:read"}' };
        },
      },
    });
    const { cookie, state } = await signIn(app);

    const response = await app.inject({ url: `/callback?code=the-code&state=${state}`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(exchanged).toHaveLength(1);
    expect(exchanged[0]?.[0]).toBe("the-code");
    expect(response.body).toContain("ory_at_demo");
    expect(response.body).toContain("&#60;Alice&#62;");
    expect(response.body).not.toContain("<Alice>");
    expect(apiCalls).toEqual(["ory_at_demo"]);
    expect(response.body).toContain("http://api.test/api/me");
    // api:read was requested but not granted, so the API refuses the token.
    expect(response.body).toMatch(/<code>api:read<\/code><\/td><td class="bad">not granted/);
    expect(response.body).toContain("insufficient_scope");
  });

  it("refuses a callback whose state does not match this browser's flow", async () => {
    const app = await createApp();
    const { cookie } = await signIn(app);

    expect((await app.inject({ url: "/callback?code=x&state=forged", headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject("/callback?code=x&state=anything")).statusCode).toBe(400);
  });

  it("shows why access was not granted when the user denies consent", async () => {
    const app = await createApp();

    const response = await app.inject("/callback?error=access_denied&error_description=The+user+denied+the+request.");

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("access_denied: The user denied the request.");
  });

  it("reports a refused code without a stack trace", async () => {
    const app = await createApp({
      tokens: {
        exchange: async () => {
          throw new TokenExchangeError("The authorization code has already been used.");
        },
      },
    });
    const { cookie, state } = await signIn(app);

    const response = await app.inject({ url: `/callback?code=used&state=${state}`, headers: { cookie } });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("already been used");
  });
});

describe("HttpApiCaller", () => {
  it("sends the access token as a bearer token", async () => {
    const seen: Array<[string, string | null]> = [];
    const caller = new HttpApiCaller("http://api.internal", async (input, init) => {
      seen.push([String(input), new Headers(init?.headers).get("authorization")]);
      return new Response('{"subject":"user-alice"}', { status: 200 });
    });

    expect(await caller.getMe("ory_at_demo")).toEqual({ status: 200, body: '{"subject":"user-alice"}' });
    expect(seen).toEqual([["http://api.internal/api/me", "Bearer ory_at_demo"]]);
  });

  it("reports an unreachable API as a result, not an exception", async () => {
    const caller = new HttpApiCaller("http://api.internal", async () => {
      throw new TypeError("fetch failed");
    });

    expect((await caller.getMe("t")).status).toBe(502);
  });
});
