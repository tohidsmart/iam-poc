import { z } from "zod";
import {
  HydraChallengeError,
  HydraUnavailableError,
  type AcceptLogin,
  type HydraAdminClient,
  type LoginRequest,
} from "../ports/hydra-admin-client.js";

export interface HydraHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
}

// Hydra is trusted but still external: validate what we read from it.
const loginRequestSchema = z.object({
  challenge: z.string(),
  skip: z.boolean(),
  subject: z.string(),
  client: z.object({
    client_id: z.string(),
    client_name: z.string().optional(),
  }),
});

const redirectSchema = z.object({ redirect_to: z.string().url() });

// 400/404: unknown or malformed challenge. 410: already accepted or rejected.
const CHALLENGE_STATUSES = new Set([400, 404, 410]);

export class HydraHttpClient implements HydraAdminClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: HydraHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
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
    const data = await this.call("GET", "login", { login_challenge: challenge }, loginRequestSchema);
    return {
      challenge: data.challenge,
      skip: data.skip,
      subject: data.subject,
      clientId: data.client.client_id,
      clientName: data.client.client_name || data.client.client_id,
    };
  }

  async acceptLogin(challenge: string, body: AcceptLogin): Promise<string> {
    const data = await this.call("PUT", "login/accept", { login_challenge: challenge }, redirectSchema, {
      subject: body.subject,
      remember: body.remember,
      remember_for: body.rememberForSeconds,
    });
    return data.redirect_to;
  }

  private async call<T>(
    method: "GET" | "PUT",
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/admin/oauth2/auth/requests/${path}?${new URLSearchParams(query)}`;

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new HydraUnavailableError(`${method} ${path}: request failed`, { cause: error });
    }

    if (CHALLENGE_STATUSES.has(response.status)) {
      throw new HydraChallengeError(`${method} ${path}: challenge refused with status ${response.status}`);
    }
    if (!response.ok) {
      throw new HydraUnavailableError(`${method} ${path}: unexpected status ${response.status}`);
    }

    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new HydraUnavailableError(`${method} ${path}: unexpected response body`);
    }
    return parsed.data;
  }
}
