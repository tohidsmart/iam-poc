# Login & Consent Service for Ory Hydra

A custom login and consent application for [Ory Hydra](https://www.ory.sh/hydra/), written in Node and TypeScript, with a compose stack that runs the whole OAuth2 Authorization Code flow end to end.

Hydra is the authorization server. It issues tokens but deliberately owns no users and no UI; it redirects the browser to an external app to answer two questions: *who is this?* and *do they agree?* This repository is that app, plus what is needed to demonstrate and test it.

> This is a proof of concept. The approach, design decisions and trade-offs are in [DESIGN.md](DESIGN.md).

## Quick start

Requires Docker with Compose.

```bash
./scripts/setup.sh                    # generates secrets into ./secrets (gitignored)
docker compose up -d --build --wait   # starts everything and registers the demo client
```

Open **http://127.0.0.1:5555** and click **Sign in**.

| Demo user | Password |
|---|---|
| `alice` | `demo-password-alice` |
| `bob` | `demo-password-bob` |

These are test credentials. Only their argon2id hashes are stored, in `login/config/users.yml`.

The result page shows the granted scopes, the ID token claims, the access token, and the response from a protected API called with that token. Untick a permission on the consent page to see each of those change.

To run the same flow automatically in a real browser (needs Node 22; the stack must be up):

```bash
cd e2e && npm ci && npm run setup && npm run e2e:headed    # 7 Playwright tests, about 12 seconds
```

| URL | What |
|---|---|
| http://127.0.0.1:5555 | Demo client app (start here) |
| http://127.0.0.1:3000 | Login and consent service (this project) |
| http://127.0.0.1:4444 | Hydra public API |
| http://127.0.0.1:4000/api/me | Demo resource server |
| http://127.0.0.1:3000/metrics | Prometheus metrics |

Hydra's admin API (4445) and Postgres are not reachable from the host, on purpose.

### Unit tests

```bash
cd login && npm ci && npm run lint && npm test      # 78 tests, no network or Hydra needed
cd resource-server && npm ci && npm test            # 15 tests
```

## The flow

```
Browser      Demo client :5555     Hydra public :4444     Login/consent :3000     Hydra admin :4445
   |-- click Sign in -->|
   |<-- 302 /oauth2/auth?client_id&scope&state&code_challenge
   |------------------------------------->|
   |<-- 302 /login?login_challenge=... ---|
   |------------------------------------------------------------>|-- get login request ------>|
   |<-- login form ----------------------------------------------|
   |-- username + password ------------------------------------->|-- accept login {subject} ->|
   |<-- 302 back to Hydra ---------------------------------------|
   |------------------------------------->|
   |<-- 302 /consent?consent_challenge=...|
   |------------------------------------------------------------>|-- get consent request ---->|
   |<-- consent form --------------------------------------------|
   |-- Allow + ticked scopes ----------------------------------->|-- accept consent {scopes} >|
   |<-- 302 back to Hydra ---------------------------------------|
   |------------------------------------->|
   |<-- 302 /callback?code=...&state=... -|
   |------------------->|-- POST /oauth2/token (code + code_verifier) -->|        (back channel)
   |                    |<-- access, refresh and ID tokens --------------|
   |                    |-- GET /api/me, Bearer token --> Resource server :4000 --> introspect (admin)
```

The login service never sees a code or a token. It only tells Hydra's admin API who the subject is and which scopes were granted.

## Repository layout

```
compose.yaml              the stack and its trust boundaries
scripts/setup.sh          generates local secrets
scripts/register-clients.sh   registers OAuth2 clients from ory-hydra/clients
ory-hydra/config/         non-secret Hydra configuration
ory-hydra/clients/        OAuth2 clients as data
login/                    the login and consent service  <-- the deliverable
resource-server/          demo client app and demo API (one image, two roles)
e2e/                      Playwright tests
spec.md, spec.refined.md  the original and refined specifications
DESIGN.md                 approach, technical decisions and trade-offs
```

## Design in brief

The login service is a layered web app: controllers (`src/http`) call services (`src/services`), services depend only on interfaces (`src/ports`), and adapters (`src/adapters`) implement them. `src/main.ts` is the only place that constructs adapters or reads the environment, so every service is unit-tested with fakes and no network.

| Requirement | How it is met |
|---|---|
| SOLID, testable | Ports and adapters with constructor injection; 78 tests run without Hydra |
| Container best practice | Multi-stage build, digest-pinned base image, non-root, read-only filesystem, no capabilities, graceful shutdown |
| Trust boundaries | Three networks; Hydra's admin API is bound to the admin network only and is never published. The demo client cannot reach it (asserted by the end-to-end tests) |
| Secrets | Generated locally, gitignored, mounted as files at run time; no secret in config, environment or image |
| Seeded users | `login/config/users.yml`, argon2id hashes only; anything else is refused at start-up |
| Logging | JSON audit events for login, consent and logout outcomes: `docker compose logs login \| grep '"audit":true'` |
| Monitoring | Prometheus metrics at `/metrics`: outcome counters, request and Hydra-call latency |
| Scalability | The service is stateless (no database, no server session); Postgres is the single point of failure |
| Automated end-to-end | Seven Playwright tests drive a real browser through the whole flow |

The reasoning behind these choices, the alternatives considered and the known gaps are in [DESIGN.md](DESIGN.md).
