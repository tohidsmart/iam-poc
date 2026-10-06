import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { User } from "../src/domain/user.js";
import { buildApp } from "../src/http/app.js";
import {
  HydraChallengeError,
  HydraUnavailableError,
  type AcceptLogin,
  type HydraAdminClient,
  type LoginRequest,
} from "../src/ports/hydra-admin-client.js";
import type { PasswordHasher } from "../src/ports/password-hasher.js";
import type { UserRepository } from "../src/ports/user-repository.js";
import { LoginService } from "../src/services/login-service.js";

/** In-memory stand-in for Hydra's admin API that records what it was told. */
export class FakeHydra implements HydraAdminClient {
  ready = true;
  down = false;
  readonly loginRequests = new Map<string, LoginRequest>();
  readonly acceptedLogins: Array<{ challenge: string; body: AcceptLogin }> = [];

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

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async getLoginRequest(challenge: string): Promise<LoginRequest> {
    if (this.down) throw new HydraUnavailableError("fake hydra is down");
    const request = this.loginRequests.get(challenge);
    if (request === undefined) throw new HydraChallengeError("unknown challenge");
    return request;
  }

  async acceptLogin(challenge: string, body: AcceptLogin): Promise<string> {
    await this.getLoginRequest(challenge);
    this.acceptedLogins.push({ challenge, body });
    return `http://hydra.test/oauth2/auth?login_verifier=${challenge}`;
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

export const alice: User = {
  id: "user-alice",
  username: "alice",
  passwordHash: "hashed:correct-password",
  name: "Alice Example",
  email: "alice@example.com",
};

export const usersOf = (...users: User[]): UserRepository => ({
  findByUsername: async (username) => users.find((user) => user.username === username),
});

export interface TestContext {
  readonly hydra: FakeHydra;
  readonly hasher: FakeHasher;
  readonly login: LoginService;
}

export function createServices(): TestContext {
  const hydra = new FakeHydra();
  const hasher = new FakeHasher();
  const login = new LoginService(hydra, usersOf(alice), hasher, {
    rememberForSeconds: 3600,
    dummyHash: "hashed:nobody-knows-this",
  });
  return { hydra, hasher, login };
}

export async function createApp(
  overrides: { loginAttemptsPerMinute?: number } = {},
): Promise<TestContext & { app: FastifyInstance }> {
  const context = createServices();
  const app = await buildApp({
    hydra: context.hydra,
    login: context.login,
    viewsDirectory: join(import.meta.dirname, "..", "views"),
    cookieSecret: "t".repeat(32),
    cookieSecure: false,
    loginAttemptsPerMinute: overrides.loginAttemptsPerMinute ?? 100,
  });
  return { ...context, app };
}
