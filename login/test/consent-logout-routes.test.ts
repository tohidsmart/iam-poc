import { describe, expect, it } from "vitest";
import { createApp, openForm, postForm } from "./support.js";

describe("consent pages", () => {
  it("lists the requested scopes with the client name escaped", async () => {
    const { app, hydra } = await createApp();
    hydra.addConsentRequest({ clientName: "<b>Evil</b>", requestedScopes: ["openid", "custom:read"] });

    const { response } = await openForm(app, "/consent?consent_challenge=consent-1");

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(response.body).toContain("Confirm who you are");
    expect(response.body).toContain('value="custom:read"');
  });

  it("redirects without a page when consent can be skipped", async () => {
    const { app, hydra } = await createApp();
    hydra.addConsentRequest({ skip: true });

    expect((await app.inject("/consent?consent_challenge=consent-1")).statusCode).toBe(302);
  });

  it("grants the ticked scopes on Allow, including a single ticked box", async () => {
    const { app, hydra } = await createApp();
    hydra.addConsentRequest();
    const { token, cookie } = await openForm(app, "/consent?consent_challenge=consent-1");

    const response = await postForm(
      app,
      "/consent",
      [["_csrf", token], ["consent_challenge", "consent-1"], ["decision", "allow"], ["scope", "openid"]],
      cookie,
    );

    expect(response.statusCode).toBe(302);
    expect(hydra.acceptedConsents[0]?.body.grantedScopes).toEqual(["openid"]);
  });

  it("rejects on Deny and sends the browser back to the client", async () => {
    const { app, hydra } = await createApp();
    hydra.addConsentRequest();
    const { token, cookie } = await openForm(app, "/consent?consent_challenge=consent-1");

    const response = await postForm(
      app,
      "/consent",
      [["_csrf", token], ["consent_challenge", "consent-1"], ["decision", "deny"], ["scope", "openid"]],
      cookie,
    );

    expect(response.headers.location).toBe("http://client.test/callback?error=access_denied");
    expect(hydra.acceptedConsents).toEqual([]);
  });

  it("refuses a decision without a CSRF token or with an unknown value", async () => {
    const { app, hydra } = await createApp();
    hydra.addConsentRequest();
    const { token, cookie } = await openForm(app, "/consent?consent_challenge=consent-1");
    const fields = (decision: string): Array<[string, string]> => [["consent_challenge", "consent-1"], ["decision", decision], ["scope", "openid"]];

    expect((await postForm(app, "/consent", fields("allow"), cookie)).statusCode).toBe(403);
    expect((await postForm(app, "/consent", [["_csrf", token], ...fields("maybe")], cookie)).statusCode).toBe(400);
    expect(hydra.acceptedConsents).toEqual([]);
  });
});

describe("logout pages", () => {
  it("asks for confirmation, then signs out and records it", async () => {
    const { app, hydra, events } = await createApp();
    hydra.addLogoutRequest();
    const { response, token, cookie } = await openForm(app, "/logout?logout_challenge=logout-1");

    const result = await postForm(app, "/logout", [["_csrf", token], ["logout_challenge", "logout-1"], ["decision", "yes"]], cookie);

    expect(response.statusCode).toBe(200);
    expect(result.statusCode).toBe(302);
    expect(hydra.logouts).toEqual([{ challenge: "logout-1", accepted: true }]);
    expect(events.events).toEqual([{ type: "logout", subject: "user-alice" }]);
  });

  it("keeps the session when the user declines", async () => {
    const { app, hydra, events } = await createApp();
    hydra.addLogoutRequest();
    const { token, cookie } = await openForm(app, "/logout?logout_challenge=logout-1");

    const result = await postForm(app, "/logout", [["_csrf", token], ["logout_challenge", "logout-1"], ["decision", "no"]], cookie);

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("still signed in");
    expect(hydra.logouts).toEqual([{ challenge: "logout-1", accepted: false }]);
    expect(events.events).toEqual([]);
  });

  it("shows a plain page for an unknown logout challenge", async () => {
    const { app } = await createApp();

    expect((await app.inject("/logout?logout_challenge=made-up")).statusCode).toBe(400);
  });
});
