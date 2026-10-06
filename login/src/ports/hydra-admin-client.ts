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

/** A consent decision that Hydra is waiting on. The subject is already authenticated. */
export interface ConsentRequest {
  readonly challenge: string;
  /** True when the user already granted these scopes to this client and chose to be remembered. */
  readonly skip: boolean;
  readonly subject: string;
  readonly clientId: string;
  readonly clientName: string;
  /** True for first-party clients configured in Hydra to never show a consent screen. */
  readonly clientSkipsConsent: boolean;
  readonly requestedScopes: readonly string[];
  readonly requestedAudience: readonly string[];
}

export interface AcceptConsent {
  readonly grantedScopes: readonly string[];
  readonly grantedAudience: readonly string[];
  readonly remember: boolean;
  readonly rememberForSeconds: number;
  /** Extra claims for the ID token. */
  readonly idTokenClaims: Readonly<Record<string, unknown>>;
}

export interface LogoutRequest {
  readonly subject: string;
}

/** The challenge is unknown, expired or already used. The user must restart from the client app. */
export class HydraChallengeError extends Error {
  override readonly name = "HydraChallengeError";
}

/** Hydra could not be reached or answered in a way we cannot use. Retrying later may work. */
export class HydraUnavailableError extends Error {
  override readonly name = "HydraUnavailableError";
}

// Each consumer depends only on the slice of Hydra it uses. Every method that
// takes a challenge throws HydraChallengeError or HydraUnavailableError, and
// every accept/reject resolves to the URL the browser must be sent to next.

export interface HydraHealth {
  /** Resolves true when the admin API is reachable and reports ready. Never rejects. */
  isReady(): Promise<boolean>;
}

export interface LoginFlow {
  getLoginRequest(challenge: string): Promise<LoginRequest>;
  acceptLogin(challenge: string, body: AcceptLogin): Promise<string>;
}

export interface ConsentFlow {
  getConsentRequest(challenge: string): Promise<ConsentRequest>;
  acceptConsent(challenge: string, body: AcceptConsent): Promise<string>;
  rejectConsent(challenge: string, reason: string): Promise<string>;
}

export interface LogoutFlow {
  getLogoutRequest(challenge: string): Promise<LogoutRequest>;
  acceptLogout(challenge: string): Promise<string>;
  rejectLogout(challenge: string): Promise<void>;
}

/** Everything this service needs from Hydra's admin API. */
export interface HydraAdminClient extends HydraHealth, LoginFlow, ConsentFlow, LogoutFlow {}
