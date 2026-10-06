import { describe, expect, it } from "vitest";
import { HydraChallengeError, HydraUnavailableError } from "../src/ports/hydra-admin-client.js";
import { createServices, ctx } from "./support.js";

const good = { username: "alice", password: "correct-password", remember: false };

describe("LoginService.begin", () => {
  it("asks for credentials on a fresh login", async () => {
    const { login, hydra } = createServices();
    hydra.addLoginRequest({ clientName: "Demo App" });

    expect(await login.begin("challenge-1", ctx)).toEqual({ kind: "prompt", clientName: "Demo App" });
    expect(hydra.acceptedLogins).toEqual([]);
  });

  it("accepts without credentials when Hydra already has a session", async () => {
    const { login, hydra, hasher } = createServices();
    hydra.addLoginRequest({ skip: true, subject: "user-alice" });

    const outcome = await login.begin("challenge-1", ctx);

    expect(outcome.kind).toBe("redirect");
    expect(hydra.acceptedLogins).toEqual([
      { challenge: "challenge-1", body: { subject: "user-alice", remember: false, rememberForSeconds: 0 } },
    ]);
    expect(hasher.verifications).toBe(0);
  });

  it("rejects an unknown challenge", async () => {
    const { login } = createServices();

    await expect(login.begin("made-up", ctx)).rejects.toBeInstanceOf(HydraChallengeError);
  });
});

describe("LoginService.submit", () => {
  it("accepts valid credentials using the stable user id as subject", async () => {
    const { login, hydra } = createServices();
    hydra.addLoginRequest();

    const outcome = await login.submit("challenge-1", good, ctx);

    expect(outcome).toEqual({ kind: "redirect", to: "http://hydra.test/oauth2/auth?login_verifier=challenge-1" });
    expect(hydra.acceptedLogins[0]?.body).toEqual({ subject: "user-alice", remember: false, rememberForSeconds: 3600 });
  });

  it("passes the remember choice to Hydra", async () => {
    const { login, hydra } = createServices();
    hydra.addLoginRequest();

    await login.submit("challenge-1", { ...good, remember: true }, ctx);

    expect(hydra.acceptedLogins[0]?.body.remember).toBe(true);
  });

  it("treats usernames as case-insensitive and ignores surrounding spaces", async () => {
    const { login, hydra } = createServices();
    hydra.addLoginRequest();

    expect((await login.submit("challenge-1", { ...good, username: "  Alice " }, ctx)).kind).toBe("redirect");
  });

  it("re-prompts on a wrong password and tells Hydra nothing", async () => {
    const { login, hydra } = createServices();
    hydra.addLoginRequest();

    const outcome = await login.submit("challenge-1", { ...good, password: "wrong" }, ctx);

    expect(outcome).toEqual({ kind: "prompt", clientName: "Demo App" });
    expect(hydra.acceptedLogins).toEqual([]);
  });

  it("gives an unknown user the same outcome and the same hashing work", async () => {
    const { login, hydra, hasher } = createServices();
    hydra.addLoginRequest();

    const outcome = await login.submit("challenge-1", { ...good, username: "mallory" }, ctx);

    expect(outcome).toEqual({ kind: "prompt", clientName: "Demo App" });
    expect(hasher.verifications).toBe(1);
    expect(hydra.acceptedLogins).toEqual([]);
  });

  it("checks the challenge before doing any password work", async () => {
    const { login, hasher } = createServices();

    await expect(login.submit("made-up", good, ctx)).rejects.toBeInstanceOf(HydraChallengeError);
    expect(hasher.verifications).toBe(0);
  });

  it("surfaces a Hydra outage", async () => {
    const { login, hydra } = createServices();
    hydra.down = true;

    await expect(login.submit("challenge-1", good, ctx)).rejects.toBeInstanceOf(HydraUnavailableError);
  });

  it("records who failed and who succeeded, never the password", async () => {
    const { login, hydra, events } = createServices();
    hydra.addLoginRequest();

    await login.submit("challenge-1", { ...good, username: "Mallory", password: "guess" }, ctx);
    await login.submit("challenge-1", good, ctx);

    expect(events.events).toEqual([
      { type: "login.failed", username: "mallory", clientId: "demo-client", reason: "invalid_credentials" },
      { type: "login.succeeded", subject: "user-alice", clientId: "demo-client", method: "password" },
    ]);
    expect(JSON.stringify(events.events)).not.toContain("guess");
  });
});
