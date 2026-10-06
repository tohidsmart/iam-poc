/** Where a request came from, so an audit line can be tied to an access-log line. */
export interface RequestContext {
  readonly requestId: string;
  readonly ip: string;
}

/** The security-relevant things that happen in this service: who, what, for which client. */
export type AuthEvent =
  | { readonly type: "login.succeeded"; readonly subject: string; readonly clientId: string; readonly method: "password" | "session" }
  | { readonly type: "login.failed"; readonly username: string; readonly clientId: string; readonly reason: "invalid_credentials" }
  | {
      readonly type: "consent.granted";
      readonly subject: string;
      readonly clientId: string;
      readonly requestedScopes: readonly string[];
      readonly grantedScopes: readonly string[];
      readonly method: "user" | "remembered";
    }
  | {
      readonly type: "consent.denied";
      readonly subject: string;
      readonly clientId: string;
      readonly requestedScopes: readonly string[];
      readonly reason: "user_denied" | "unknown_user";
    }
  | { readonly type: "logout"; readonly subject: string };

export interface AuthEventRecorder {
  /** Must not throw: recording an event never fails the request that caused it. */
  record(event: AuthEvent, context: RequestContext): void;
}
