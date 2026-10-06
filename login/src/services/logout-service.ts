import type { AuthEventRecorder, RequestContext } from "../ports/auth-event-recorder.js";
import type { LogoutFlow } from "../ports/hydra-admin-client.js";

export class LogoutService {
  constructor(
    private readonly hydra: LogoutFlow,
    private readonly events: AuthEventRecorder,
  ) {}

  /** Confirms the challenge is real before the confirmation page is shown. */
  async begin(challenge: string): Promise<void> {
    await this.hydra.getLogoutRequest(challenge);
  }

  /** @returns where to send the browser, or undefined when the user chose to stay signed in. */
  async decide(challenge: string, confirmed: boolean, context: RequestContext): Promise<string | undefined> {
    const request = await this.hydra.getLogoutRequest(challenge);
    if (!confirmed) {
      await this.hydra.rejectLogout(challenge);
      return undefined;
    }
    const to = await this.hydra.acceptLogout(challenge);
    this.events.record({ type: "logout", subject: request.subject }, context);
    return to;
  }
}
