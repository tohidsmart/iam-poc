// Server-rendered demo pages. No template engine: every dynamic value goes
// through `esc`, and there is no client-side script.

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  pre { padding: 0.75rem; border: 1px solid #8884; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .ok { color: #1a7f37; } .bad { color: #b00020; }
  a.button { display: inline-block; padding: 0.6rem 1rem; border: 1px solid; border-radius: 6px; text-decoration: none; }
  table { border-collapse: collapse; } td, th { text-align: left; padding: 0.2rem 1rem 0.2rem 0; vertical-align: top; }
</style>
</head>
<body>
${body}
</body>
</html>`;

export const homePage = (): string =>
  page(
    "Demo App",
    `<h1>Demo App</h1>
<p>A stand-in OAuth2 client. Signing in sends you to Hydra, which hands over to the login and consent service and then returns you here with an authorization code.</p>
<p><a class="button" href="/signin">Sign in</a></p>
<p>Demo users: <code>alice</code> / <code>demo-password-alice</code> and <code>bob</code> / <code>demo-password-bob</code>.</p>`,
  );

export interface ResultView {
  readonly requestedScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly idTokenClaims: Readonly<Record<string, unknown>> | undefined;
  readonly accessToken: string;
  readonly hasRefreshToken: boolean;
  readonly expiresIn: number;
  readonly api: { readonly status: number; readonly body: string };
  readonly apiUrl: string;
  readonly logoutUrl: string | undefined;
}

export const resultPage = (view: ResultView): string => {
  const scopeRows = view.requestedScopes
    .map((scope) => {
      const granted = view.grantedScopes.includes(scope);
      return `<tr><td><code>${esc(scope)}</code></td><td class="${granted ? "ok" : "bad"}">${granted ? "granted" : "not granted"}</td></tr>`;
    })
    .join("\n");
  const apiOk = view.api.status === 200;

  return page(
    "Signed in",
    `<h1>Signed in</h1>

<h2>1. Scopes</h2>
<table><tr><th>Requested</th><th>Consent</th></tr>
${scopeRows}
</table>

<h2>2. ID token claims</h2>
<p>Who the user is. The <code>name</code> and <code>email</code> claims appear only when those scopes were granted.</p>
<pre>${esc(view.idTokenClaims ? JSON.stringify(view.idTokenClaims, null, 2) : "No ID token: the openid scope was not granted.")}</pre>

<h2>3. Access token</h2>
<p>Opaque: it carries no readable content. Expires in ${esc(view.expiresIn)} seconds. Refresh token issued: ${view.hasRefreshToken ? "yes" : "no"}.</p>
<pre>${esc(view.accessToken)}</pre>

<h2>4. Calling the API with it</h2>
<p><code>GET /api/me</code> requires the <code>api:read</code> scope. The resource server, a separate service, asked Hydra what this token is allowed to do and answered
<strong class="${apiOk ? "ok" : "bad"}">${esc(view.api.status)}</strong>:</p>
<pre>${esc(view.api.body)}</pre>
<p>Try it yourself:</p>
<pre>curl -i -H "Authorization: Bearer ${esc(view.accessToken)}" ${esc(view.apiUrl)}</pre>

<p><a class="button" href="/signin">Sign in again</a>
${view.logoutUrl ? `<a class="button" href="${esc(view.logoutUrl)}">Sign out</a>` : ""}</p>
<p>Signing in again skips the password while the Hydra session lasts. Untick a permission on the consent page to see the result change.</p>`,
  );
};

export const failurePage = (title: string, detail: string): string =>
  page(title, `<h1>${esc(title)}</h1>\n<p>${esc(detail)}</p>\n<p><a class="button" href="/">Start again</a></p>`);
