import { describe, expect, it } from "vitest";
import { HydraHttpClient } from "../src/adapters/hydra-http-client.js";
import { HydraChallengeError, HydraUnavailableError } from "../src/ports/hydra-admin-client.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function clientReturning(status: number, body: unknown = {}) {
  const calls: Call[] = [];
  const client = new HydraHttpClient({
    baseUrl: "http://hydra:4445/",
    timeoutMs: 50,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    },
  });
  return { client, calls };
}

const failingClient = () =>
  new HydraHttpClient({
    baseUrl: "http://hydra:4445",
    timeoutMs: 50,
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });

describe("HydraHttpClient.isReady", () => {
  it("calls the admin readiness endpoint", async () => {
    const { client, calls } = clientReturning(200);

    expect(await client.isReady()).toBe(true);
    expect(calls[0]?.url).toBe("http://hydra:4445/health/ready");
  });

  it("is false on a non-2xx response or a failed request", async () => {
    expect(await clientReturning(503).client.isReady()).toBe(false);
    expect(await failingClient().isReady()).toBe(false);
  });
});

describe("HydraHttpClient.getLoginRequest", () => {
  const hydraBody = { challenge: "c 1", skip: false, subject: "", client: { client_id: "abc", client_name: "Demo App" } };

  it("maps Hydra's response and encodes the challenge", async () => {
    const { client, calls } = clientReturning(200, hydraBody);

    expect(await client.getLoginRequest("c 1")).toEqual({
      challenge: "c 1",
      skip: false,
      subject: "",
      clientId: "abc",
      clientName: "Demo App",
    });
    expect(calls[0]?.url).toBe("http://hydra:4445/admin/oauth2/auth/requests/login?login_challenge=c+1");
  });

  it("falls back to the client id when the client has no name", async () => {
    const { client } = clientReturning(200, { ...hydraBody, client: { client_id: "abc", client_name: "" } });

    expect((await client.getLoginRequest("c")).clientName).toBe("abc");
  });

  it.each([400, 404, 410])("reports status %i as a challenge problem", async (status) => {
    await expect(clientReturning(status).client.getLoginRequest("c")).rejects.toBeInstanceOf(HydraChallengeError);
  });

  it("reports server errors, bad bodies and network failures as unavailable", async () => {
    await expect(clientReturning(500).client.getLoginRequest("c")).rejects.toBeInstanceOf(HydraUnavailableError);
    await expect(clientReturning(200, { nope: 1 }).client.getLoginRequest("c")).rejects.toBeInstanceOf(HydraUnavailableError);
    await expect(clientReturning(200, "<html>").client.getLoginRequest("c")).rejects.toBeInstanceOf(HydraUnavailableError);
    await expect(failingClient().getLoginRequest("c")).rejects.toBeInstanceOf(HydraUnavailableError);
  });
});

describe("HydraHttpClient.acceptLogin", () => {
  it("sends the subject and returns where to redirect", async () => {
    const { client, calls } = clientReturning(200, { redirect_to: "http://127.0.0.1:4444/oauth2/auth?x=1" });

    const to = await client.acceptLogin("c", { subject: "user-1", remember: true, rememberForSeconds: 60 });

    expect(to).toBe("http://127.0.0.1:4444/oauth2/auth?x=1");
    expect(calls[0]).toEqual({
      url: "http://hydra:4445/admin/oauth2/auth/requests/login/accept?login_challenge=c",
      method: "PUT",
      body: { subject: "user-1", remember: true, remember_for: 60 },
    });
  });
});

describe("HydraHttpClient consent and logout", () => {
  it("maps a consent request, tolerating absent optional fields", async () => {
    const { client, calls } = clientReturning(200, { challenge: "c", subject: "user-1", client: { client_id: "abc" } });

    expect(await client.getConsentRequest("c")).toEqual({
      challenge: "c",
      skip: false,
      subject: "user-1",
      clientId: "abc",
      clientName: "abc",
      clientSkipsConsent: false,
      requestedScopes: [],
      requestedAudience: [],
    });
    expect(calls[0]?.url).toBe("http://hydra:4445/admin/oauth2/auth/requests/consent?consent_challenge=c");
  });

  it("sends granted scopes and ID token claims on accept", async () => {
    const { client, calls } = clientReturning(200, { redirect_to: "http://127.0.0.1:4444/next" });

    await client.acceptConsent("c", {
      grantedScopes: ["openid"],
      grantedAudience: [],
      remember: false,
      rememberForSeconds: 0,
      idTokenClaims: { email: "a@example.com" },
    });

    expect(calls[0]).toEqual({
      url: "http://hydra:4445/admin/oauth2/auth/requests/consent/accept?consent_challenge=c",
      method: "PUT",
      body: {
        grant_scope: ["openid"],
        grant_access_token_audience: [],
        remember: false,
        remember_for: 0,
        session: { id_token: { email: "a@example.com" } },
      },
    });
  });

  it("sends access_denied on reject", async () => {
    const { client, calls } = clientReturning(200, { redirect_to: "http://client.test/cb" });

    await client.rejectConsent("c", "The user denied the request.");

    expect(calls[0]?.body).toEqual({ error: "access_denied", error_description: "The user denied the request." });
  });

  it("accepts an empty 204 answer when rejecting a logout", async () => {
    const client = new HydraHttpClient({
      baseUrl: "http://hydra:4445",
      timeoutMs: 50,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(client.rejectLogout("c")).resolves.toBeUndefined();
  });

  it("reports the outcome and duration of each call", async () => {
    const seen: Array<[string, boolean]> = [];
    const client = new HydraHttpClient({
      baseUrl: "http://hydra:4445",
      timeoutMs: 50,
      fetch: async () => new Response("{}", { status: 404 }),
      onCall: (operation, ok) => seen.push([operation, ok]),
    });

    await expect(client.getLogoutRequest("c")).rejects.toBeInstanceOf(HydraChallengeError);
    expect(seen).toEqual([["logout.get", false]]);
  });
});
