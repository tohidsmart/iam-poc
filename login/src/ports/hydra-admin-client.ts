/** A login that Hydra is waiting on us to accept or reject. */
export interface LoginRequest {
  readonly challenge: string;
  /** True when Hydra already has a session for this browser: accept without asking again. */
  readonly skip: boolean;
  /** The remembered subject. Only meaningful when `skip` is true. */
  readonly subject: string;
  readonly clientId: string;
  readonly clientName: string;
}

export interface AcceptLogin {
  readonly subject: string;
  readonly remember: boolean;
  readonly rememberForSeconds: number;
}

/** The challenge is unknown, expired or already used. The user must restart from the client app. */
export class HydraChallengeError extends Error {
  override readonly name = "HydraChallengeError";
}

/** Hydra could not be reached or answered in a way we cannot use. Retrying later may work. */
export class HydraUnavailableError extends Error {
  override readonly name = "HydraUnavailableError";
}

/** What this service needs from Hydra's admin API. Grows with each flow. */
export interface HydraAdminClient {
  /** Resolves true when the admin API is reachable and reports ready. Never rejects. */
  isReady(): Promise<boolean>;

  /** @throws HydraChallengeError | HydraUnavailableError */
  getLoginRequest(challenge: string): Promise<LoginRequest>;

  /**
   * Tells Hydra who logged in.
   * @returns the URL to send the browser to next.
   * @throws HydraChallengeError | HydraUnavailableError
   */
  acceptLogin(challenge: string, body: AcceptLogin): Promise<string>;
}
