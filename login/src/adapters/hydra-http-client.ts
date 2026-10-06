import type { HydraAdminClient } from "../ports/hydra-admin-client.js";

export interface HydraHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
}

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
}
