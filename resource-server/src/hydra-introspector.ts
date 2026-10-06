import { IntrospectionUnavailableError, type TokenInfo, type TokenIntrospector } from "./token-introspector.js";

export interface HydraIntrospectorOptions {
  readonly adminUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Asks Hydra about an opaque access token (RFC 7662). Opaque tokens carry no
 * readable content, so every request costs one call to Hydra; in exchange a
 * revoked token stops working immediately.
 */
export class HydraIntrospector implements TokenIntrospector {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: HydraIntrospectorOptions) {
    this.url = `${options.adminUrl.replace(/\/+$/, "")}/admin/oauth2/introspect`;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async introspect(token: string): Promise<TokenInfo | undefined> {
    let body: unknown;
    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      body = await response.json();
    } catch (error) {
      throw new IntrospectionUnavailableError("token introspection failed", { cause: error });
    }

    const data = body as { active?: unknown; sub?: unknown; client_id?: unknown; scope?: unknown; token_use?: unknown };
    // Refresh tokens also introspect as active; only access tokens may call the API.
    if (data.active !== true || data.token_use !== "access_token") return undefined;
    if (typeof data.sub !== "string" || typeof data.client_id !== "string") return undefined;
    return {
      subject: data.sub,
      clientId: data.client_id,
      scopes: typeof data.scope === "string" ? data.scope.split(" ").filter(Boolean) : [],
    };
  }
}
