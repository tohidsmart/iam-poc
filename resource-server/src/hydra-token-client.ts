import { TokenExchangeError, type TokenExchanger, type TokenSet } from "./token-exchanger.js";

export interface HydraTokenClientOptions {
  /** Hydra's public API as reachable from this server (the back channel). */
  readonly publicUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Exchanges an authorization code for tokens. This is a public client: it has
 * no client secret, so the PKCE code verifier is what proves that the party
 * redeeming the code is the one that started the flow.
 */
export class HydraTokenClient implements TokenExchanger {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: HydraTokenClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async exchange(code: string, codeVerifier: string): Promise<TokenSet> {
    let status: number;
    let body: Record<string, unknown>;
    try {
      const response = await this.fetch(`${this.options.publicUrl.replace(/\/+$/, "")}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.options.clientId,
          redirect_uri: this.options.redirectUri,
          code,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(5000),
      });
      status = response.status;
      body = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new TokenExchangeError("the token endpoint could not be reached", { cause: error });
    }

    if (status !== 200 || typeof body.access_token !== "string") {
      throw new TokenExchangeError(String(body.error_description ?? body.error ?? `status ${status}`));
    }
    return {
      accessToken: body.access_token,
      idToken: typeof body.id_token === "string" ? body.id_token : undefined,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      scope: typeof body.scope === "string" ? body.scope : "",
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : 0,
    };
  }
}
