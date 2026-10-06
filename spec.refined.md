# Login & Consent Service for Ory Hydra — Refined Spec

Status: IMPLEMENTED. Sections 1-11 are the refinement written before any code and are kept as written; section 12 records the decisions taken and the outcome. `spec.md` is left untouched.
Legend: **[DECIDED]** taken from the original spec · **[PROPOSED]** my default, veto freely · **[OPEN]** needs your call

---

## 1. Problem and goal

Ory Hydra is an OAuth 2.0 / OpenID Connect authorization server that deliberately owns **no users and no UI**. It delegates "who is this person?" and "do they agree?" to an external *login & consent app* through a redirect + admin-API handshake.

We build that app: a Node/TypeScript service that authenticates seeded users, collects consent, and tells Hydra the outcome, so that an OAuth2 client can complete the **Authorization Code flow** end to end and receive access, refresh and ID tokens.

Success = one command brings the stack up, and an automated test drives a browser through login → consent → code → token exchange with no manual steps.

## 2. Scope

| In | Out |
|---|---|
| Login + consent (+ logout **[PROPOSED]**) endpoints against Hydra's admin API | User sign-up, password reset, MFA |
| Seeded users from config, hashed passwords | External IdP / federation |
| Dockerfile + compose stack (Hydra, Postgres, our service) | CI/CD, cloud, Kubernetes |
| Bootstrap: OAuth2 client registration | Machine-to-machine (client credentials) flow |
| Unit tests, automated E2E flow | Custom Hydra build or schema changes |
| Structured audit logs, metrics endpoint | Dashboards/alerting (stretch) |
| Secret management for local/offline use | Cloud KMS wiring (documented only) |
| Design doc with trade-offs | |

Stretch, in priority order **[OPEN — see Q3]**: Playwright E2E · demo resource server using token introspection · Prometheus container · JWT access tokens.

## 3. The flow (what we are actually implementing)

```
Browser        Client app         Hydra public :4444      Login/Consent svc :3000     Hydra admin :4445
   |-- GET /oauth2/auth?client_id&scope&state&code_challenge -->|
   |<-- 302 /login?login_challenge=LC --------------------------|
   |-- GET /login?login_challenge=LC ------------------------------->|-- GET login request(LC) ------>|
   |<-- login form (or skip if Hydra says session exists) -----------|
   |-- POST /login (user, pass, csrf) ------------------------------>|-- PUT login/accept {subject} ->|
   |<-- 302 redirect_to (back to Hydra) -----------------------------|
   |-- Hydra -> 302 /consent?consent_challenge=CC
   |-- GET /consent?consent_challenge=CC --------------------------->|-- GET consent request(CC) ---->|
   |-- POST /consent (granted scopes, csrf) ------------------------>|-- PUT consent/accept {scopes} >|
   |<-- 302 redirect_to -> Hydra -> 302 client redirect_uri?code=... |
   |               |-- POST /oauth2/token (code, code_verifier) -->|
   |               |<-- access_token, refresh_token, id_token -----|
```

Our service never sees the authorization code or the tokens. It only answers two questions to Hydra's **admin** API: "who is the subject" and "which scopes were granted". That is why the admin API is the crown jewel (see §7.1).

## 4. Answers to "unknown to me"

**Does the access token contain the scope?** By default Hydra issues **opaque** access tokens (the 94-char value in `token.json`). The scope is not *in* the token; it is returned alongside it in the token response and by the introspection endpoint (`POST /admin/oauth2/introspect`), which a resource server calls. If you switch `strategies.access_token: jwt`, the scope appears as the `scp` claim. Trade-off: opaque = instantly revocable, costs a network call per validation; JWT = offline validation, not revocable until expiry. **[PROPOSED]** stay opaque.

**OAuth2 grant types — is "authorization code" the human one?** Yes.

| Grant | Who | Uses login/consent app? |
|---|---|---|
| Authorization Code (+PKCE) | Human in a browser | **Yes — this task** |
| Device Authorization | Human on a TV/CLI | Yes (the `device` URLs in `hydra.yml`) |
| Refresh Token | Client renewing a prior grant | No |
| Client Credentials | Machine-to-machine | No — no user, no consent |
| Implicit | Legacy browser apps | Yes, but deprecated; do not enable |

A task that asks for a login and consent service is asking for the human flow. M2M is correctly out of scope.

**Sensitive values in `hydra.yml`:**

| Key | Purpose | Rotation |
|---|---|---|
| `secrets.system` | Encrypts data at rest in Postgres (signing keys/JWKs, flow state) and keys the HMAC for opaque tokens and auth codes | It is a list. Prepend a new secret: first entry signs/encrypts, the rest still verify/decrypt. Remove old ones after token lifetimes expire. |
| `secrets.cookie` (unset → falls back to system) | Signs Hydra's session/CSRF cookies | Same list mechanism |
| `oidc.subject_identifiers.pairwise.salt` | Salt for hashing `sub` per client sector so clients cannot correlate users | **Cannot be rotated** — changing it changes every user's `sub` at every pairwise client |
| `DSN` (compose env) | Postgres credentials | Rotate in Postgres, restart Hydra |

Losing `secrets.system` = the encrypted JWKs in the DB are unreadable. It must be backed up alongside (but separately from) DB backups. This is your disaster-recovery talking point.

**Database schema and migrations.** The Postgres database belongs entirely to Hydra: clients, flows, consent sessions, tokens, JWKs. Migrations are versioned SQL files embedded in the Hydra binary; `hydra migrate sql up` applies those not yet recorded in its migration table, and is idempotent. Hydra does **not** auto-migrate on `serve` — hence the separate one-shot `hydra-migrate` container that `hydra` waits on. In production that maps to a pre-deploy job; upgrades are "run new version's migrate, then roll the servers". **Our service has no database** **[PROPOSED]**: users come from config, flow state lives in Hydra. That keeps it stateless and removes any migration story of our own.

## 5. Functional requirements

- **FR1 Login.** `GET /login` fetches the login request; if Hydra reports `skip: true`, accept immediately without UI. Otherwise render a form. `POST /login` verifies credentials and accepts, or re-renders with a generic error. Unknown/expired challenge → error page, never a stack trace.
- **FR2 Consent.** `GET /consent` shows client name and requested scopes; accepts silently when `skip` is true. `POST /consent` accepts with the *subset* of scopes the user ticked, or rejects with `access_denied`. Only scopes that were actually requested can be granted.
- **FR3 Logout** **[PROPOSED]** `GET/POST /logout` with `logout_challenge`. Small, and `hydra.yml` already points at it.
- **FR4 Users.** Loaded at startup from a config file, validated against a schema; startup fails fast on invalid config. Passwords are **hashed with argon2id** — hashed, not encrypted, and not optional (pushback, §9).
- **FR5 ID token claims.** Consent maps granted scopes (`profile`, `email`) to claims from the user record.
- **FR6 Bootstrap.** A one-shot compose service registers the demo OAuth2 client via Hydra CLI (out of the box, as the spec asks).
- **FR7 Health.** `/health/live` and `/health/ready` (ready = Hydra admin reachable).

## 6. Architecture

Stack: Node 22 LTS, TypeScript strict. Web framework and DI style **[OPEN — Q2]**.

```
src/
  config/        schema-validated config + secret loading (env and *_FILE)
  domain/        User, AuthResult — no framework imports
  ports/         interfaces: HydraAdminClient, UserRepository, PasswordHasher, AuditLogger, Metrics
  adapters/      HydraHttpClient, FileUserRepository, Argon2Hasher, PinoAuditLogger, PromMetrics
  services/      LoginService, ConsentService — depend on ports only
  http/          routes/controllers, CSRF, security headers, error handler, views
  main.ts        composition root: the only place that news-up adapters
```

How this maps to SOLID, so you can defend it: services have one reason to change each (S); new user stores or hashers are new adapters, not edits (O); adapters are substitutable behind ports, which is what makes the unit tests fakes rather than mocks of HTTP (L, D); ports are small and role-specific (I).

Testing pyramid: unit (services with fake ports) → HTTP integration (app with fake Hydra client) → E2E (real compose stack).

Container: multi-stage build, pinned base image by digest, `npm ci`, production deps only in the final stage, non-root user, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, `HEALTHCHECK`, graceful `SIGTERM` handling with `node` as the direct entrypoint.

## 7. Non-functional requirements

### 7.1 Security

**Trust boundaries [PROPOSED]:**

| Network | Members | Host-published |
|---|---|---|
| `public` | hydra (4444), login (3000) | yes |
| `admin` | hydra (4445), login, client-bootstrap | **no** |
| `db` | hydra, hydra-migrate, postgres | **no** |

Honest limit: Docker networks isolate containers, not ports, so anything on a network with Hydra can reach both its ports. Not publishing 4445 and keeping untrusted containers off `admin` is the POC control. Production answer: network policy and mTLS or an authenticating proxy in front of the admin API.

**Blast radius if the login service is compromised:** the attacker holds admin-API access and can accept a login as *any* subject for any client — full identity takeover, plus client management. They do not get Hydra's signing keys or the DB. Mitigations to discuss: proxy that exposes only the four login/consent admin routes to this service; short token lifetimes; audit logs shipped off-box; revoke consent sessions and rotate `secrets.system` as the recovery runbook.

**App-level controls:** CSRF protection on both forms, session-less design, `helmet`-style headers with a strict CSP, constant-time credential check that also hashes for unknown users (no user enumeration by timing), generic error messages, login rate limiting, input validation at the edge, no secrets or passwords in logs.

**Secrets [OPEN — Q1].** Corrections to the original spec's understanding of SOPS: it encrypts **values only** (keys stay readable, so diffs and reviews still work), and it supports age, PGP *and* cloud KMS as key sources. You are right that it ends in "one key you must protect" — every scheme does (the secret-zero problem). The gain is going from N plaintext secrets in the repo to one key outside it, which in the cloud becomes an IAM-controlled KMS key with no file at all. PGP works but age is the simpler modern choice.

### 7.2 Logging

JSON to stdout (twelve-factor; the platform ships it). Separate **audit** events from app logs:

| Event | Fields |
|---|---|
| `login.succeeded` / `login.failed` | time, subject or attempted username, client_id, reason, ip, request id |
| `consent.granted` / `consent.denied` | time, subject, client_id, requested vs granted scopes |
| `logout` | time, subject |

**Gap in the original spec:** "who obtained an access token" cannot be logged by our service — token issuance happens at Hydra's `/oauth2/token`, which we never see. That evidence comes from Hydra's own request logs, correlated to our events by client_id and subject. Worth stating explicitly in the write-up rather than pretending we cover it.

### 7.3 Monitoring

- Our service: `/metrics` (Prometheus format) — counters for login/consent outcomes by result, histograms for request duration and Hydra admin-call duration.
- Hydra: its built-in Prometheus endpoint on the admin port gives authorize and token requests/sec.
- **"Time to complete the flow"** needs a definition. Server-side we can only observe login-request-seen → consent-accepted, which includes human think time. **[PROPOSED]** record that as a histogram and additionally report true end-to-end time from the E2E test.

### 7.4 Scalability and availability

- Login service: stateless, no DB, no server session → N replicas behind any load balancer, no sticky sessions.
- Hydra: also stateless; all state in Postgres → scale horizontally the same way.
- Postgres: the single point of failure and the real HA question. Production answer is a managed HA Postgres with PITR; in compose it is one container, stated as a known limit.
- Things that break statelessness if done naively: in-memory rate limiting (per-replica, so the effective limit multiplies) and reloading users from disk. Called out, not solved, in the POC.

## 8. Issues found in the current repo

1. `compose.yaml` mounts `./config`, but the file lives at `ory-hydra/config/hydra.yml` — the stack will not start from the repo root as-is. (The running `ory-hdra-*` containers were evidently started from elsewhere; I have not touched them, but they hold ports 3000/4444/4445/5432.)
2. Hydra admin `4445` and Postgres `5432` are published to the host — contradicts the trust-boundary requirement.
3. `serve ... --dev` disables Hydra's HTTPS enforcement. Fine locally, must be named as a deliberate POC shortcut.
4. Secrets are literal `youReallyNeedToChangeThis` / `secret`, repeated in two DSNs.
5. `consent` still points at Ory's reference image; to be replaced by `./login`.
6. `token.json` contains real (if local) tokens — should be gitignored. There is no git repo yet.
7. `login/Dockerfile` uses `node:latest` — unpinned.

## 9. Pushback on the original spec

- **"WSGI"** is a Python interface; it has no Node equivalent and Node does not need a separate app server. The equivalent concern is process management: one Node process per container, correct signal handling, scale by replicas.
- **"Optionally encrypted password"** → must be *hashed*, and not optional. Reversible encryption of passwords is a finding in any security review; a plaintext seed file would undercut the rest of the security story.
- **"Out of scope: K8s/cloud" vs the NFRs.** You noticed the tension yourself. Resolution: implement what compose can express (network segmentation, non-root, secrets as files) and *document* the production mapping in a short table. Do not fake cloud controls locally.
- **"Production-ready but not finished"** is unresolvable without a time budget. The spec has none. **[OPEN]**
- **Missing decisions:** web framework, DI approach, test runner, server-rendered vs SPA forms (assumed server-rendered), "remember me" behaviour, whether the demo client is public+PKCE or confidential (assumed public+PKCE), access-token format.

## 10. Feedback on the spec as a spec

What worked: the intent paragraph gives the *why*; constraints and out-of-scope are explicit; and the "unknown to me" section is the most useful part — it told me where to explain rather than just build. Keep doing that.

What made it harder to act on:

1. **The source brief is missing.** The spec refers to "the task briefing" and "acceptance criteria" that I cannot see. I am working from your paraphrase, so I cannot check whether the spec covers what interviewers will grade. Highest-value fix: drop the brief in as `brief.md`.
2. **No definition of done.** Nothing is testable as written. Each requirement wants a check ("`docker compose up` then `npm run e2e` exits 0").
3. **Requirements, opinions, questions and doubts are interleaved.** "Not sure", "I think", "potentially" appear inside requirement bullets, so I have to guess which sentences bind. Separate *must / should / open question*.
4. **No priorities or time box**, so every NFR reads as equally mandatory.
5. **Ambiguous terms**: WSGI, "encrypted password", "consent service" (used for both login and consent), "custom if we have time".
6. **No interface-level detail**: endpoints, config shape, and event names were all left for me to invent. That is fine if intended — say "you decide, show me" so it is delegation rather than omission.

A template that would have cut my guessing roughly in half: Goal · Definition of done · Must/Should/Won't · Constraints · Decisions already made · Open questions · Things I want explained.

## 11. Delivery plan

1. Repo hygiene: git init, `.gitignore`, fix compose paths, network split, secrets wiring.
2. Service skeleton: config, ports, composition root, health, container.
3. Login flow + unit tests.
4. Consent (+ logout) + unit tests.
5. Client bootstrap + scripted E2E.
6. Audit logging + metrics.
7. Design/trade-off document (`README.md`).
8. Stretch items.

Each step ends with something runnable and a checkpoint with you.

## 12. Decisions taken and outcome

The original task brief was deliberately withheld while this spec was written, to test whether a spec derived from the problem alone would cover it. Compare the two at the end.

| Open item | Decision |
|---|---|
| Time box | Half a day |
| Secrets (Q1) | Generated files mounted as compose secrets; SOPS and KMS documented as the next step |
| Framework and DI (Q2) | Fastify; manual constructor injection with one composition root |
| Stretch (Q3) | Playwright end-to-end tests; demo resource server; a demo client app was added so the flow can be clicked through |
| Token format | Opaque |
| Demo client | Public client with PKCE |
| Logout | Included |

Changes from the plan in section 7:

- The admin API is bound to the `admin` network interface, so the boundary is enforced, not only drawn.
- The demo client and the resource server are separate services, because the client belongs outside the trust boundary.
- No server-side "time to complete the flow" metric; the end-to-end test reports it.
- No Prometheus container.

### Definition of done

| # | Check | Status |
|---|---|---|
| 1 | `./scripts/setup.sh && docker compose up -d --build --wait` starts the stack with no manual edits | Met |
| 2 | `npm test` in `login/` passes with no network | Met (78 tests) |
| 3 | `npm run e2e` drives a browser through login, consent, token exchange and an API call; covers wrong password and denied consent | Met (7 tests) |
| 4 | Hydra admin and Postgres are not reachable from the host | Met; asserted by the end-to-end suite |
| 5 | No secret value is committed | Met; `secrets/` is gitignored and the Hydra config holds none |
| 6 | Login container is non-root, read-only, with no capabilities | Met |
| 7 | Audit lines for login and consent outcomes; `/metrics` exposes outcome counters | Met |
| 8 | `README.md` explains design, trade-offs and the production answer to each shortcut | Met |
