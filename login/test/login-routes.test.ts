import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { createApp } from "./support.js";

/** Loads the form the way a browser would and returns what it needs to post it. */
async function openForm(app: FastifyInstance, challenge = "challenge-1") {
  const response = await app.inject(`/login?login_challenge=${challenge}`);
  const token = /name="_csrf" value="([^"]+)"/.exec(response.body)?.[1] ?? "";
  const setCookie = response.headers["set-cookie"];
  const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";", 1)[0] ?? "";
  return { response, token, cookie };
}

const post = (app: FastifyInstance, fields: Record<string, string>, cookie?: string) =>
  app.inject({
    method: "POST",
    url: "/login",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });

const credentials = { login_challenge: "challenge-1", username: "alice", password: "correct-password" };

describe("GET /login", () => {
  it("renders the form with the client name escaped", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest({ clientName: "<script>alert(1)</script>" });

    const { response, token } = await openForm(app);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(response.body).not.toContain("<script>");
    expect(token).not.toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("redirects straight back to Hydra when the login can be skipped", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest({ skip: true, subject: "user-alice" });

    const response = await app.inject("/login?login_challenge=challenge-1");

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("http://hydra.test/");
  });

  it("refuses a request without a challenge", async () => {
    const { app } = await createApp();

    expect((await app.inject("/login")).statusCode).toBe(400);
  });

  it("shows a plain page for an unknown challenge", async () => {
    const { app } = await createApp();

    const response = await app.inject("/login?login_challenge=made-up");

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("no longer valid");
  });

  it("answers 503 without internal detail when Hydra is down", async () => {
    const { app, hydra } = await createApp();
    hydra.down = true;

    const response = await app.inject("/login?login_challenge=challenge-1");

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("fake hydra is down");
  });
});

describe("POST /login", () => {
  it("accepts valid credentials and redirects to Hydra", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app);

    const response = await post(app, { ...credentials, _csrf: token }, cookie);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://hydra.test/oauth2/auth?login_verifier=challenge-1");
    expect(hydra.acceptedLogins).toHaveLength(1);
  });

  it("re-renders with a generic error and never echoes the password", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app);

    const response = await post(app, { ...credentials, password: "wrong-password", _csrf: token }, cookie);

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("The username or password is incorrect.");
    expect(response.body).toContain('value="alice"');
    expect(response.body).not.toContain("wrong-password");
    expect(hydra.acceptedLogins).toEqual([]);
  });

  it("gives an unknown user exactly the same page as a wrong password", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app);
    const strip = (body: string) => body.replace(/name="_csrf" value="[^"]+"/, "").replace(/value="(alice|mallory)"/, "");

    const wrongPassword = await post(app, { ...credentials, password: "wrong", _csrf: token }, cookie);
    const unknownUser = await post(app, { ...credentials, username: "mallory", _csrf: token }, cookie);

    expect(unknownUser.statusCode).toBe(wrongPassword.statusCode);
    expect(strip(unknownUser.body)).toBe(strip(wrongPassword.body));
  });

  it("refuses a post without a CSRF token", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { cookie } = await openForm(app);

    const response = await post(app, credentials, cookie);

    expect(response.statusCode).toBe(403);
    expect(hydra.acceptedLogins).toEqual([]);
  });

  it("refuses a token that does not match the browser's cookie", async () => {
    const { app, hydra } = await createApp();
    hydra.addLoginRequest();
    const { token } = await openForm(app);

    expect((await post(app, { ...credentials, _csrf: token })).statusCode).toBe(403);
  });

  it("refuses an oversized password before hashing it", async () => {
    const { app, hydra, hasher } = await createApp();
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app);

    const response = await post(app, { ...credentials, password: "x".repeat(2000), _csrf: token }, cookie);

    expect(response.statusCode).toBe(400);
    expect(hasher.verifications).toBe(0);
  });

  it("limits repeated attempts", async () => {
    const { app, hydra } = await createApp({ loginAttemptsPerMinute: 2 });
    hydra.addLoginRequest();
    const { token, cookie } = await openForm(app);
    const attempt = () => post(app, { ...credentials, password: "wrong", _csrf: token }, cookie);

    await attempt();
    await attempt();

    expect((await attempt()).statusCode).toBe(429);
  });
});

describe("unknown routes", () => {
  it("returns a plain 404 page", async () => {
    const { app } = await createApp();

    const response = await app.inject("/nope");

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("text/html");
  });
});
