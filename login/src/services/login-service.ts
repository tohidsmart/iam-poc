import { normaliseUsername } from "../domain/user.js";
import type { AuthEventRecorder, RequestContext } from "../ports/auth-event-recorder.js";
import type { LoginFlow } from "../ports/hydra-admin-client.js";
import type { PasswordHasher } from "../ports/password-hasher.js";
import type { UserRepository } from "../ports/user-repository.js";

export type LoginOutcome =
  /** Hydra has been told who the user is; send the browser on. */
  | { readonly kind: "redirect"; readonly to: string }
  /** Show the form (first visit, or credentials were refused). */
  | { readonly kind: "prompt"; readonly clientName: string };

export interface Credentials {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}

export interface LoginServiceOptions {
  readonly rememberForSeconds: number;
  /** A valid hash of a password nobody knows; verified against when the user does not exist. */
  readonly dummyHash: string;
}

export class LoginService {
  constructor(
    private readonly hydra: LoginFlow,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly events: AuthEventRecorder,
    private readonly options: LoginServiceOptions,
  ) {}

  /** The browser has arrived from Hydra with a login challenge. */
  async begin(challenge: string, context: RequestContext): Promise<LoginOutcome> {
    const request = await this.hydra.getLoginRequest(challenge);
    if (!request.skip) return { kind: "prompt", clientName: request.clientName };

    // Hydra already authenticated this browser. Its remembered subject is the
    // only identity we may confirm; credentials are not involved.
    const to = await this.hydra.acceptLogin(challenge, {
      subject: request.subject,
      remember: false,
      rememberForSeconds: 0,
    });
    this.events.record(
      { type: "login.succeeded", subject: request.subject, clientId: request.clientId, method: "session" },
      context,
    );
    return { kind: "redirect", to };
  }

  /** The user has submitted the form. */
  async submit(challenge: string, credentials: Credentials, context: RequestContext): Promise<LoginOutcome> {
    // Validate the challenge before spending CPU on a password hash.
    const request = await this.hydra.getLoginRequest(challenge);

    const username = normaliseUsername(credentials.username);
    const user = await this.users.findByUsername(username);
    // Always run one verification, so an unknown username takes as long as a
    // wrong password and cannot be told apart by timing.
    const passwordOk = await this.hasher.verify(user?.passwordHash ?? this.options.dummyHash, credentials.password);
    if (user === undefined || !passwordOk) {
      this.events.record(
        { type: "login.failed", username, clientId: request.clientId, reason: "invalid_credentials" },
        context,
      );
      return { kind: "prompt", clientName: request.clientName };
    }

    const to = await this.hydra.acceptLogin(challenge, {
      subject: user.id,
      remember: credentials.remember,
      rememberForSeconds: this.options.rememberForSeconds,
    });
    this.events.record(
      { type: "login.succeeded", subject: user.id, clientId: request.clientId, method: "password" },
      context,
    );
    return { kind: "redirect", to };
  }
}
