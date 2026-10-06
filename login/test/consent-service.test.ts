import { describe, expect, it } from "vitest";
import { HydraChallengeError } from "../src/ports/hydra-admin-client.js";
import { createServices, ctx } from "./support.js";

const allow = (scopes: string[], remember = false) => ({ allow: true, scopes, remember });

describe("ConsentService.begin", () => {
  it("asks the user on a first request", async () => {
    const { consent, hydra } = createServices();
    hydra.addConsentRequest();

    expect(await consent.begin("consent-1", ctx)).toEqual({
      kind: "prompt",
      clientName: "Demo App",
      requestedScopes: ["openid", "profile", "email"],
    });
    expect(hydra.acceptedConsents).toEqual([]);
  });

  it.each([{ skip: true }, { clientSkipsConsent: true }])("grants everything requested without asking when %o", async (flags) => {
    const { consent, hydra, events } = createServices();
    hydra.addConsentRequest(flags);

    expect((await consent.begin("consent-1", ctx)).kind).toBe("redirect");
    expect(hydra.acceptedConsents[0]?.body.grantedScopes).toEqual(["openid", "profile", "email"]);
    expect(events.events[0]).toMatchObject({ type: "consent.granted", method: "remembered" });
  });

  it("rejects an unknown challenge", async () => {
    const { consent } = createServices();

    await expect(consent.begin("made-up", ctx)).rejects.toBeInstanceOf(HydraChallengeError);
  });
});

describe("ConsentService.decide", () => {
  it("grants only the scopes the user left ticked", async () => {
    const { consent, hydra } = createServices();
    hydra.addConsentRequest({ requestedAudience: ["https://api.example"] });

    await consent.decide("consent-1", allow(["openid", "email"], true), ctx);

    expect(hydra.acceptedConsents[0]?.body).toEqual({
      grantedScopes: ["openid", "email"],
      grantedAudience: ["https://api.example"],
      remember: true,
      rememberForSeconds: 3600,
      idTokenClaims: { email: "alice@example.com" },
    });
  });

  it("never grants a scope the client did not request", async () => {
    const { consent, hydra } = createServices();
    hydra.addConsentRequest({ requestedScopes: ["openid"] });

    await consent.decide("consent-1", allow(["openid", "admin", "offline_access"]), ctx);

    expect(hydra.acceptedConsents[0]?.body.grantedScopes).toEqual(["openid"]);
  });

  it("adds profile claims only when the profile scope is granted", async () => {
    const { consent, hydra } = createServices();
    hydra.addConsentRequest();

    await consent.decide("consent-1", allow(["openid", "profile"]), ctx);

    expect(hydra.acceptedConsents[0]?.body.idTokenClaims).toEqual({ name: "Alice Example", preferred_username: "alice" });
  });

  it("rejects with Hydra when the user denies", async () => {
    const { consent, hydra, events } = createServices();
    hydra.addConsentRequest();

    const outcome = await consent.decide("consent-1", { allow: false, scopes: ["openid"], remember: false }, ctx);

    expect(outcome).toEqual({ kind: "redirect", to: "http://client.test/callback?error=access_denied" });
    expect(hydra.acceptedConsents).toEqual([]);
    expect(events.events).toEqual([
      {
        type: "consent.denied",
        subject: "user-alice",
        clientId: "demo-client",
        requestedScopes: ["openid", "profile", "email"],
        reason: "user_denied",
      },
    ]);
  });

  it("treats allowing nothing as a denial", async () => {
    const { consent, hydra } = createServices();
    hydra.addConsentRequest();

    await consent.decide("consent-1", allow([]), ctx);

    expect(hydra.rejectedConsents).toHaveLength(1);
  });

  it("denies when the account behind a remembered session no longer exists", async () => {
    const { consent, hydra, events } = createServices();
    hydra.addConsentRequest({ subject: "user-deleted" });

    await consent.decide("consent-1", allow(["openid"]), ctx);

    expect(hydra.acceptedConsents).toEqual([]);
    expect(events.events[0]).toMatchObject({ type: "consent.denied", reason: "unknown_user" });
  });

  it("records what was requested and what was granted", async () => {
    const { consent, hydra, events } = createServices();
    hydra.addConsentRequest();

    await consent.decide("consent-1", allow(["openid"]), ctx);

    expect(events.events).toEqual([
      {
        type: "consent.granted",
        subject: "user-alice",
        clientId: "demo-client",
        requestedScopes: ["openid", "profile", "email"],
        grantedScopes: ["openid"],
        method: "user",
      },
    ]);
  });
});
