import type { User } from "../domain/user.js";
import type { AuthEventRecorder, RequestContext } from "../ports/auth-event-recorder.js";
import type { ConsentFlow, ConsentRequest } from "../ports/hydra-admin-client.js";
import type { UserRepository } from "../ports/user-repository.js";

export type ConsentOutcome =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "prompt"; readonly clientName: string; readonly requestedScopes: readonly string[] };

export interface ConsentDecision {
  readonly allow: boolean;
  /** The scopes the user left ticked. Untrusted: it comes from the form. */
  readonly scopes: readonly string[];
  readonly remember: boolean;
}

export interface ConsentServiceOptions {
  readonly rememberForSeconds: number;
}

/** Standard OIDC scope-to-claim mapping, limited to what a seeded user has. */
function idTokenClaims(user: User, grantedScopes: readonly string[]): Record<string, unknown> {
  return {
    ...(grantedScopes.includes("profile") ? { name: user.name, preferred_username: user.username } : {}),
    ...(grantedScopes.includes("email") ? { email: user.email } : {}),
  };
}

export class ConsentService {
  constructor(
    private readonly hydra: ConsentFlow,
    private readonly users: UserRepository,
    private readonly events: AuthEventRecorder,
    private readonly options: ConsentServiceOptions,
  ) {}

  /** The browser has arrived from Hydra with a consent challenge. */
  async begin(challenge: string, context: RequestContext): Promise<ConsentOutcome> {
    const request = await this.hydra.getConsentRequest(challenge);
    if (!request.skip && !request.clientSkipsConsent) {
      return { kind: "prompt", clientName: request.clientName, requestedScopes: request.requestedScopes };
    }
    // Already granted earlier, or a first-party client: nothing to ask.
    return this.grant(request, request.requestedScopes, false, "remembered", context);
  }

  /** The user has pressed Allow or Deny. */
  async decide(challenge: string, decision: ConsentDecision, context: RequestContext): Promise<ConsentOutcome> {
    const request = await this.hydra.getConsentRequest(challenge);

    // Never grant more than the client asked for, whatever the form says.
    const granted = request.requestedScopes.filter((scope) => decision.scopes.includes(scope));
    if (!decision.allow || granted.length === 0) {
      return this.deny(request, "user_denied", "The user denied the request.", context);
    }
    return this.grant(request, granted, decision.remember, "user", context);
  }

  private async grant(
    request: ConsentRequest,
    grantedScopes: readonly string[],
    remember: boolean,
    method: "user" | "remembered",
    context: RequestContext,
  ): Promise<ConsentOutcome> {
    const user = await this.users.findById(request.subject);
    // A remembered session can outlive the account it belongs to.
    if (user === undefined) return this.deny(request, "unknown_user", "The account no longer exists.", context);

    const to = await this.hydra.acceptConsent(request.challenge, {
      grantedScopes,
      grantedAudience: request.requestedAudience,
      remember,
      rememberForSeconds: this.options.rememberForSeconds,
      idTokenClaims: idTokenClaims(user, grantedScopes),
    });
    this.events.record(
      {
        type: "consent.granted",
        subject: request.subject,
        clientId: request.clientId,
        requestedScopes: request.requestedScopes,
        grantedScopes,
        method,
      },
      context,
    );
    return { kind: "redirect", to };
  }

  private async deny(
    request: ConsentRequest,
    reason: "user_denied" | "unknown_user",
    description: string,
    context: RequestContext,
  ): Promise<ConsentOutcome> {
    const to = await this.hydra.rejectConsent(request.challenge, description);
    this.events.record(
      {
        type: "consent.denied",
        subject: request.subject,
        clientId: request.clientId,
        requestedScopes: request.requestedScopes,
        reason,
      },
      context,
    );
    return { kind: "redirect", to };
  }
}
