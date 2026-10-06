import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { failurePage, homePage, resultPage } from "./pages.js";
import { TokenExchangeError, type TokenExchanger } from "./token-exchanger.js";

export interface ClientSettings {
  readonly clientId: string;
  /** Hydra's public API as the browser reaches it (the front channel). */
  readonly hydraBrowserUrl: string;
  /** This app's own address as the browser reaches it. */
  readonly baseUrl: string;
  /** The resource server's address as the browser reaches it, for display. */
  readonly apiBrowserUrl: string;
  readonly scopes: readonly string[];
}

/** Calls the resource server the way any outside caller would: over HTTP with a bearer token. */
export interface ApiCaller {
  /** Never rejects: an unreachable API is reported as a result. */
  getMe(accessToken: string): Promise<{ readonly status: number; readonly body: string }>;
}

export class HttpApiCaller implements ApiCaller {
  constructor(
    private readonly apiUrl: string,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async getMe(accessToken: string): Promise<{ status: number; body: string }> {
    try {
      const response = await this.fetch(`${this.apiUrl}/api/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.text() };
    } catch {
      return { status: 502, body: "The API could not be reached." };
    }
  }
}

const FLOW_COOKIE = "demo_flow";
const base64url = (bytes: Buffer): string => bytes.toString("base64url");

const sameString = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Reads the claims without verifying the signature; see the note at the call site. */
function decodeClaims(idToken: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The OAuth2 client half of the demo: starts the flow and handles the callback. */
export async function registerClientRoutes(
  app: FastifyInstance,
  tokens: TokenExchanger,
  api: ApiCaller,
  settings: ClientSettings,
): Promise<void> {
  await app.register(cookie);
  const redirectUri = `${settings.baseUrl}/callback`;

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(homePage()));

  app.get("/signin", async (_request, reply) => {
    // state ties the callback to this browser (CSRF). The PKCE verifier stays
    // here; only its hash travels through the browser to Hydra.
    const state = base64url(randomBytes(16));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const authorize = new URL(`${settings.hydraBrowserUrl}/oauth2/auth`);
    authorize.search = new URLSearchParams({
      client_id: settings.clientId,
      response_type: "code",
      scope: settings.scopes.join(" "),
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    return reply
      .setCookie(FLOW_COOKIE, JSON.stringify({ state, verifier }), {
        httpOnly: true,
        sameSite: "lax",
        path: "/callback",
        maxAge: 600,
      })
      .redirect(authorize.toString());
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/callback", async (request, reply) => {
    const html = (status: number, body: string) =>
      reply
        .code(status)
        .clearCookie(FLOW_COOKIE, { path: "/callback" })
        .header("cache-control", "no-store")
        .type("text/html; charset=utf-8")
        .send(body);

    const { code, state, error, error_description } = request.query;
    if (error !== undefined) {
      return html(200, failurePage("Access was not granted", `${error}: ${error_description ?? "no further detail"}`));
    }

    let flow: { state?: unknown; verifier?: unknown } = {};
    try {
      flow = JSON.parse(request.cookies[FLOW_COOKIE] ?? "{}") as typeof flow;
    } catch {
      // Treated as a missing flow below.
    }
    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      typeof flow.state !== "string" ||
      typeof flow.verifier !== "string" ||
      !sameString(state, flow.state)
    ) {
      return html(400, failurePage("That sign-in could not be completed", "It was not started from this browser, or it has expired."));
    }

    let tokenSet;
    try {
      tokenSet = await tokens.exchange(code, flow.verifier);
    } catch (exchangeError) {
      if (!(exchangeError instanceof TokenExchangeError)) throw exchangeError;
      return html(400, failurePage("The authorization code was refused", exchangeError.message));
    }

    const apiResult = await api.getMe(tokenSet.accessToken);

    const logout = tokenSet.idToken ? new URL(`${settings.hydraBrowserUrl}/oauth2/sessions/logout`) : undefined;
    logout?.searchParams.set("id_token_hint", tokenSet.idToken ?? "");
    logout?.searchParams.set("post_logout_redirect_uri", `${settings.baseUrl}/`);

    return html(
      200,
      resultPage({
        requestedScopes: settings.scopes,
        grantedScopes: tokenSet.scope.split(" ").filter(Boolean),
        // The signature is not checked: the token came straight from Hydra's
        // token endpoint over the back channel, and it is only displayed. A
        // real client verifies it against Hydra's published keys, over TLS.
        idTokenClaims: tokenSet.idToken ? decodeClaims(tokenSet.idToken) : undefined,
        accessToken: tokenSet.accessToken,
        hasRefreshToken: tokenSet.refreshToken !== undefined,
        expiresIn: tokenSet.expiresIn,
        api: apiResult,
        apiUrl: `${settings.apiBrowserUrl}/api/me`,
        logoutUrl: logout?.toString(),
      }),
    );
  });
}
