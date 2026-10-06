import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { PromMetrics } from "../src/adapters/prom-metrics.js";
import type { User } from "../src/domain/user.js";
import { buildApp } from "../src/http/app.js";
import type { AuthEvent, AuthEventRecorder, RequestContext } from "../src/ports/auth-event-recorder.js";
import {
  HydraChallengeError,
  HydraUnavailableError,
  type AcceptConsent,
  type AcceptLogin,
  type ConsentRequest,
  type HydraAdminClient,
  type LoginRequest,
  type LogoutRequest,
} from "../src/ports/hydra-admin-client.js";
import type { PasswordHasher } from "../src/ports/password-hasher.js";
import type { UserRepository } from "../src/ports/user-repository.js";
import { ConsentService } from "../src/services/consent-service.js";
import { LoginService } from "../src/services/login-service.js";
import { LogoutService } from "../src/services/logout-service.js";

export const ctx: RequestContext = { requestId: "req-test", ip: "203.0.113.7" };

/** In-memory stand-in for Hydra's admin API that records what it was told. */
export class FakeHydra implements HydraAdminClient {
  ready = true;
  down = false;
  readonly loginRequests = new Map<string, LoginRequest>();
  readonly consentRequests = new Map<string, ConsentRequest>();
  readonly logoutRequests = new Map<string, LogoutRequest>();
  readonly acceptedLogins: Array<{ challenge: string; body: AcceptLogin }> = [];
  readonly acceptedConsents: Array<{ challenge: string; body: AcceptConsent }> = [];
  readonly rejectedConsents: Array<{ challenge: string; reason: string }> = [];
  readonly logouts: Array<{ challenge: string; accepted: boolean }> = [];

  addLoginRequest(overrides: Partial<LoginRequest> = {}): LoginRequest {
    const request: LoginRequest = {
      challenge: "challenge-1",
      skip: false,
      subject: "",
      clientId: "demo-client",
      clientName: "Demo App",
      ...overrides,
    };
    this.loginRequests.set(request.challenge, request);
    return request;
  }

  addConsentRequest(overrides: Partial<ConsentRequest> = {}): ConsentRequest {
    const request: ConsentRequest = {
      challenge: "consent-1",
      skip: false,
      subject: "user-alice",
      clientId: "demo-client",
      clientName: "Demo App",
      clientSkipsConsent: false,
      requestedScopes: ["openid", "profile", "email"],
      requestedAudience: [],
      ...overrides,
    };
    this.consentRequests.set(request.challenge, request);
    return request;
  }

  addLogoutRequest(challenge = "logout-1", subject = "user-alice"): void {
    this.logoutRequests.set(challenge, { subject });
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  private lookup<T>(requests: Map<string, T>, challenge: string): T {
    if (this.down) throw new HydraUnavailableError("fake hydra is down");
    const request = requests.get(challenge);
    if (request === undefined) throw new HydraChallengeError("unknown challenge");
    return request;
  }

  async getLoginRequest(challenge: string): Promise<LoginRequest> {
    return this.lookup(this.loginRequests, challenge);
  }

  async acceptLogin(challenge: string, body: AcceptLogin): Promise<string> {
    this.lookup(this.loginRequests, challenge);
    this.acceptedLogins.push({ challenge, body });
    return `http://hydra.test/oauth2/auth?login_verifier=${challenge}`;
  }

  async getConsentRequest(challenge: string): Promise<ConsentRequest> {
    return this.lookup(this.consentRequests, challenge);
  }

  async acceptConsent(challenge: string, body: AcceptConsent): Promise<string> {
    this.lookup(this.consentRequests, challenge);
    this.acceptedConsents.push({ challenge, body });
    return `http://hydra.test/oauth2/auth?consent_verifier=${challenge}`;
  }

  async rejectConsent(challenge: string, reason: string): Promise<string> {
    this.lookup(this.consentRequests, challenge);
    this.rejectedConsents.push({ challenge, reason });
    return "http://client.test/callback?error=access_denied";
  }

  async getLogoutRequest(challenge: string): Promise<LogoutRequest> {
    return this.lookup(this.logoutRequests, challenge);
  }

  async acceptLogout(challenge: string): Promise<string> {
    this.lookup(this.logoutRequests, challenge);
    this.logouts.push({ challenge, accepted: true });
    return "http://hydra.test/oauth2/sessions/logout?logout_verifier=x";
  }

  async rejectLogout(challenge: string): Promise<void> {
    this.lookup(this.logoutRequests, challenge);
    this.logouts.push({ challenge, accepted: false });
  }
}

/** Reversible "hash" so tests stay fast and readable; counts verifications. */
export class FakeHasher implements PasswordHasher {
  verifications = 0;

  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    this.verifications += 1;
    return hash === `hashed:${password}`;
  }
}

export class RecordingEvents implements AuthEventRecorder {
  readonly events: AuthEvent[] = [];

  record(event: AuthEvent): void {
    this.events.push(event);
  }
}

export const alice: User = {
  id: "user-alice",
  username: "alice",
  passwordHash: "hashed:correct-password",
  name: "Alice Example",
  email: "alice@example.com",
};

export const usersOf = (...users: User[]): UserRepository => ({
  findByUsername: async (username) => users.find((user) => user.username === username),
  findById: async (id) => users.find((user) => user.id === id),
});

export interface TestContext {
  readonly hydra: FakeHydra;
  readonly hasher: FakeHasher;
  readonly events: RecordingEvents;
  readonly login: LoginService;
  readonly consent: ConsentService;
  readonly logout: LogoutService;
}

export function createServices(): TestContext {
  const hydra = new FakeHydra();
  const hasher = new FakeHasher();
  const events = new RecordingEvents();
  const users = usersOf(alice);
  const login = new LoginService(hydra, users, hasher, events, {
    rememberForSeconds: 3600,
    dummyHash: "hashed:nobody-knows-this",
  });
  const consent = new ConsentService(hydra, users, events, { rememberForSeconds: 3600 });
  const logout = new LogoutService(hydra, events);
  return { hydra, hasher, events, login, consent, logout };
}

export async function createApp(
  overrides: { loginAttemptsPerMinute?: number } = {},
): Promise<TestContext & { app: FastifyInstance }> {
  const context = createServices();
  const app = await buildApp({
    hydra: context.hydra,
    login: context.login,
    consent: context.consent,
    logout: context.logout,
    metrics: new PromMetrics({ defaultMetrics: false }),
    viewsDirectory: join(import.meta.dirname, "..", "views"),
    cookieSecret: "t".repeat(32),
    cookieSecure: false,
    loginAttemptsPerMinute: overrides.loginAttemptsPerMinute ?? 100,
  });
  return { ...context, app };
}

/** Loads a form the way a browser would and returns what is needed to post it. */
export async function openForm(app: FastifyInstance, url: string) {
  const response = await app.inject(url);
  const token = /name="_csrf" value="([^"]+)"/.exec(response.body)?.[1] ?? "";
  const setCookie = response.headers["set-cookie"];
  const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";", 1)[0] ?? "";
  return { response, token, cookie };
}

export const postForm = (app: FastifyInstance, url: string, fields: Array<[string, string]>, cookie?: string) =>
  app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
