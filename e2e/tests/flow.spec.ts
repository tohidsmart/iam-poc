import { expect, test, type Page } from "@playwright/test";
import { forgetConsent } from "./reset.js";

const LOGIN_URL = /^http:\/\/127\.0\.0\.1:3000\/login\?/;
const CONSENT_URL = /^http:\/\/127\.0\.0\.1:3000\/consent\?/;
const HYDRA_ADMIN = process.env.HYDRA_ADMIN_URL ?? "http://127.0.0.1:4445";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";

// Matches login/config/users.yml.
const alice = {
  id: "7f1c7b0e-6a0b-4e0e-9a55-2f1f5a7f3a01",
  username: "alice",
  password: "demo-password-alice",
  name: "Alice Example",
};

// Every test gets a fresh browser context, so no login session carries over,
// and starts with no remembered consent.
test.beforeEach(() => forgetConsent(alice.id));

async function startSignIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(LOGIN_URL);
}

async function logIn(page: Page, password = alice.password): Promise<void> {
  await page.getByLabel("Username").fill(alice.username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const scopeRow = (page: Page, scope: string) =>
  page.getByRole("row").filter({ has: page.getByText(scope, { exact: true }) });

const apiStatus = (page: Page) => page.locator("strong").first();

test("signs in, consents, receives tokens and calls the API", async ({ page, request }) => {
  const started = Date.now();
  await startSignIn(page);
  await expect(page.getByText("to continue to Demo App")).toBeVisible();

  await logIn(page);
  await expect(page).toHaveURL(CONSENT_URL);
  await expect(page.getByText("Demo App would like to:")).toBeVisible();

  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();
  test.info().annotations.push({ type: "flow duration", description: `${Date.now() - started} ms` });
  console.log(`  full flow, sign-in click to tokens: ${Date.now() - started} ms`);

  for (const scope of ["openid", "profile", "email", "offline_access", "api:read"]) {
    await expect(scopeRow(page, scope)).toContainText("granted");
    await expect(scopeRow(page, scope)).not.toContainText("not granted");
  }
  // ID token claims come from the seeded user, via the consent service.
  const claims = page.locator("pre").nth(0);
  await expect(claims).toContainText(`"name": "${alice.name}"`);
  await expect(claims).toContainText('"email": "alice@example.com"');
  await expect(claims).toContainText('"iss": "http://127.0.0.1:4444"');
  await expect(page.getByText("Refresh token issued: yes")).toBeVisible();

  // The demo client called the resource server with the access token.
  await expect(apiStatus(page)).toHaveText("200");

  // The same token works for an independent caller, and a made-up one does not.
  const accessToken = (await page.locator("pre").nth(1).innerText()).trim();
  const me = await request.get(`${API}/api/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ client: "demo-app", scopes: expect.arrayContaining(["api:read"]) });
  expect((await request.get(`${API}/api/me`, { headers: { authorization: "Bearer made-up" } })).status()).toBe(401);
});

test("refuses a wrong password without saying which part was wrong", async ({ page }) => {
  await startSignIn(page);

  await logIn(page, "not-the-password");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("alert")).toHaveText("The username or password is incorrect.");
  await expect(page.getByLabel("Password")).toHaveValue("");

  // The same form still works with the right password.
  await logIn(page);
  await expect(page).toHaveURL(CONSENT_URL);
});

test("returns access_denied to the client when the user denies consent", async ({ page }) => {
  await startSignIn(page);
  await logIn(page);

  await page.getByRole("button", { name: "Deny" }).click();

  await expect(page.getByRole("heading", { name: "Access was not granted" })).toBeVisible();
  await expect(page.getByText("access_denied")).toBeVisible();
});

test("a scope the user withholds is missing from the token and enforced by the API", async ({ page }) => {
  await startSignIn(page);
  await logIn(page);

  await page.getByLabel("Read your data in the demo API").uncheck();
  await page.getByLabel("See your email address").uncheck();
  await page.getByRole("button", { name: "Allow" }).click();

  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();
  await expect(scopeRow(page, "api:read")).toContainText("not granted");
  await expect(scopeRow(page, "profile")).not.toContainText("not granted");
  await expect(page.locator("pre").nth(0)).not.toContainText('"email"');
  await expect(apiStatus(page)).toHaveText("403");
  await expect(page.getByText("insufficient_scope")).toBeVisible();
});

test("remembered login and consent skip their pages, and signing out ends the session", async ({ page }) => {
  await startSignIn(page);
  await page.getByLabel("Keep me signed in").check();
  await logIn(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();

  // Second sign-in: Hydra reports the login as skippable, so no password.
  await page.getByRole("link", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(CONSENT_URL);
  await page.getByLabel("Do not ask again for this app").check();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();

  // Third sign-in: consent is remembered too, so neither page is shown.
  await page.getByRole("link", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();
  await expect(apiStatus(page)).toHaveText("200");

  await page.getByRole("link", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign out?" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Demo App" })).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(LOGIN_URL);
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("shows a plain error page for a forged login challenge", async ({ page }) => {
  const response = await page.goto("http://127.0.0.1:3000/login?login_challenge=forged");

  expect(response?.status()).toBe(400);
  await expect(page.getByRole("heading", { name: "This sign-in link is no longer valid" })).toBeVisible();
});

test("the Hydra admin API is not reachable from outside the stack", async ({ request }) => {
  await expect(request.get(`${HYDRA_ADMIN}/health/ready`, { timeout: 3000 })).rejects.toThrow();
});
