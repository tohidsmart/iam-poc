import { z } from "zod";
import {
  HydraChallengeError,
  HydraUnavailableError,
  type AcceptConsent,
  type AcceptLogin,
  type ConsentRequest,
  type HydraAdminClient,
  type LoginRequest,
  type LogoutRequest,
} from "../ports/hydra-admin-client.js";

export interface HydraHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  /** Called after every admin call, for metrics. */
  readonly onCall?: (operation: string, ok: boolean, seconds: number) => void;
}

// Hydra is trusted but still external: validate what we read from it.
const clientSchema = z.object({
  client_id: z.string(),
  client_name: z.string().optional(),
  skip_consent: z.boolean().optional(),
});

const loginRequestSchema = z.object({
  challenge: z.string(),
  skip: z.boolean(),
  subject: z.string(),
  client: clientSchema,
});

const consentRequestSchema = z.object({
  challenge: z.string(),
  skip: z.boolean().optional(),
  subject: z.string(),
  requested_scope: z.array(z.string()).nullish(),
  requested_access_token_audience: z.array(z.string()).nullish(),
  client: clientSchema,
});

const logoutRequestSchema = z.object({ subject: z.string().optional() });

const redirectSchema = z.object({ redirect_to: z.string().url() });

// 400/404: unknown or malformed challenge. 410: already accepted or rejected.
const CHALLENGE_STATUSES = new Set([400, 404, 410]);

type Flow = "login" | "consent" | "logout";

export class HydraHttpClient implements HydraAdminClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;
  private readonly onCall: NonNullable<HydraHttpClientOptions["onCall"]>;

  constructor(options: HydraHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.onCall = options.onCall ?? (() => {});
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await this.fetch(`${this.baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getLoginRequest(challenge: string): Promise<LoginRequest> {
    const data = await this.call("login", "get", challenge, loginRequestSchema);
    return {
      challenge: data.challenge,
      skip: data.skip,
      subject: data.subject,
      clientId: data.client.client_id,
      clientName: data.client.client_name || data.client.client_id,
    };
  }

  async acceptLogin(challenge: string, body: AcceptLogin): Promise<string> {
    const data = await this.call("login", "accept", challenge, redirectSchema, {
      subject: body.subject,
      remember: body.remember,
      remember_for: body.rememberForSeconds,
    });
    return data.redirect_to;
  }

  async getConsentRequest(challenge: string): Promise<ConsentRequest> {
    const data = await this.call("consent", "get", challenge, consentRequestSchema);
    return {
      challenge: data.challenge,
      skip: data.skip ?? false,
      subject: data.subject,
      clientId: data.client.client_id,
      clientName: data.client.client_name || data.client.client_id,
      clientSkipsConsent: data.client.skip_consent ?? false,
      requestedScopes: data.requested_scope ?? [],
      requestedAudience: data.requested_access_token_audience ?? [],
    };
  }

  async acceptConsent(challenge: string, body: AcceptConsent): Promise<string> {
    const data = await this.call("consent", "accept", challenge, redirectSchema, {
      grant_scope: body.grantedScopes,
      grant_access_token_audience: body.grantedAudience,
      remember: body.remember,
      remember_for: body.rememberForSeconds,
      session: { id_token: body.idTokenClaims },
    });
    return data.redirect_to;
  }

  async rejectConsent(challenge: string, reason: string): Promise<string> {
    const data = await this.call("consent", "reject", challenge, redirectSchema, {
      error: "access_denied",
      error_description: reason,
    });
    return data.redirect_to;
  }

  async getLogoutRequest(challenge: string): Promise<LogoutRequest> {
    const data = await this.call("logout", "get", challenge, logoutRequestSchema);
    return { subject: data.subject ?? "" };
  }

  async acceptLogout(challenge: string): Promise<string> {
    return (await this.call("logout", "accept", challenge, redirectSchema, {})).redirect_to;
  }

  async rejectLogout(challenge: string): Promise<void> {
    await this.call("logout", "reject", challenge, undefined, {});
  }

  private async call<T>(
    flow: Flow,
    action: "get" | "accept" | "reject",
    challenge: string,
    schema: z.ZodType<T> | undefined,
    body?: unknown,
  ): Promise<T> {
    const operation = `${flow}.${action}`;
    const started = performance.now();
    let ok = false;
    try {
      const result = await this.send(flow, action, challenge, schema, body);
      ok = true;
      return result;
    } finally {
      this.onCall(operation, ok, (performance.now() - started) / 1000);
    }
  }

  private async send<T>(
    flow: Flow,
    action: "get" | "accept" | "reject",
    challenge: string,
    schema: z.ZodType<T> | undefined,
    body?: unknown,
  ): Promise<T> {
    const operation = `${flow}.${action}`;
    const path = action === "get" ? flow : `${flow}/${action}`;
    const query = new URLSearchParams({ [`${flow}_challenge`]: challenge });
    const url = `${this.baseUrl}/admin/oauth2/auth/requests/${path}?${query}`;

    let response: Response;
    try {
      response = await this.fetch(url, {
        method: action === "get" ? "GET" : "PUT",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new HydraUnavailableError(`${operation}: request failed`, { cause: error });
    }

    if (CHALLENGE_STATUSES.has(response.status)) {
      throw new HydraChallengeError(`${operation}: challenge refused with status ${response.status}`);
    }
    if (!response.ok) {
      throw new HydraUnavailableError(`${operation}: unexpected status ${response.status}`);
    }
    // Some endpoints (logout reject) answer 204 with no body.
    if (schema === undefined) return undefined as T;

    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new HydraUnavailableError(`${operation}: unexpected response body`);
    }
    return parsed.data;
  }
}
