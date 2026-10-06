# Completion flow and design decisions

I completed this task by taking the following steps.

1. I read the task brief a few times to understand the requirements, the must-haves, the marking and the acceptance criteria.

2. From there, I studied Ory's implementation of OAuth2, how Ory Hydra fits into the big picture, and decided how to replace the demo login and consent service with a custom build.

3. I went to the Ory GitHub repository and started by running the stack end to end using the Docker Compose setup provided. I chose to set up the Postgres backend from the start instead of SQLite. Running the stack involved manual steps: registering a client, starting the login flow with the demo username and password, copying the authorization code and exchanging it at Hydra's public API (the token endpoint) for access, ID and refresh tokens.

4. I was then ready to get Claude Code involved. I planned to use spec-driven development to create a constitution between my goals and the agent. Instead of providing fragmented prompts, I started by drafting `spec.md`. It outlines the problem I was trying to solve, the current state of the git repository (for example the Docker Compose file), the tech stack (Node, TypeScript, Postgres), the non-functional requirements and my expectations. See `spec.md`.

5. Claude remained faithful to our constitution, refined the spec and generated `spec.refined.md`. The feedback I got was that I used ambiguous technical terms, the definition of done was missing, and there were no priorities or time box, but that the "unknown to me" section was useful.

6. Before implementation we iterated over the technical decisions, analysed the trade-offs and locked in the scope.
   - **Secrets and sensitive credentials.** Several credentials need protecting. The most secure option outside the cloud is to encrypt the values locally with a tool such as SOPS, using an age or PGP key pair. However, we decided that for a demo application it is sufficient to generate strong credentials into files, ignore those files in the source repository, and mount them into the containers at run time (not at build time, which would bake them into image layers).
   - **Trust boundaries.** We created three Docker networks and did not publish sensitive ports such as the Hydra admin API. Each service is attached only to the networks it needs, so only specific services can talk to Hydra's admin API or the database. Docker networks separate containers, not ports, and Hydra serves both its public and admin API from one container, so at first any container on the public network could still reach the admin port. We fixed this by binding Hydra's admin API to its admin network interface only, and verified that the demo client gets "connection refused" on it. The remaining shortcoming is that the admin API has no authentication, so every service on the admin network has all of it. A more robust solution would be a network security policy, or putting the admin routes behind an authenticating proxy.
   - **Web framework.** We chose Fastify over Express because of its built-in structured logging and request validation.
   - **Users.** User registration and management were outside the scope of this exercise, but the application needs sample users, and we decided they should follow config-as-data: a YAML file mounted into the container.
   - **Password hashing.** Passwords are stored only as argon2id hashes. Argon2id is deliberately slow and memory-hungry, which makes guessing stolen hashes expensive even on GPUs, and it is the current OWASP first choice. Each hash carries its own random salt. The service refuses to start if any stored password is not an argon2id hash.
   - **Client registration.** Building a registration process was outside the scope, so the demo client is registered by a one-shot job from a JSON file (config-as-data again). The job stands in for the operator who would approve a client in production.
   - **Containers.** Every service is containerised and runs in the Docker stack the project started with.

7. The implementation started with these contracts in place.
   - Services such as login are layered and depend on interfaces, with manual constructor injection and no DI library, so that tests can use fakes with no network.
   - The interface to Hydra's admin API is split into login, consent, logout and health slices, so each service gets only what it uses.
   - Opaque access tokens were chosen over JWTs because they can be revoked immediately. The cost is one introspection call per API request.
   - The login and consent service keeps no state of its own: no database and no server-side session. That is what lets it scale by adding replicas.

8. The security implementation details came mostly from the coding agent's knowledge. I reviewed each one and can explain why it is there.
   - The response and the hashing work are the same for an unknown user and for a wrong password. This stops attackers finding out which usernames exist.
   - The database connection string (DSN) is in its own secret file, so the database password can change without touching the system secret or the salt.
   - Consent grants only the scopes that were both requested by the client and ticked by the user, so a tampered form cannot add scopes.
   - The subject sent to Hydra is a stable user ID, not the username, so a username can change without changing the identity in issued tokens.
   - The demo client and the demo API run as two separate services, because a client app sits outside the trust boundary and must not be able to reach the admin API.

9. Known gaps.
   - Hydra's admin API has no authentication. Any service on the admin network can use all of it, so a compromised login service could accept a login as any user. The fix is an authenticating proxy in front of the admin API that allows each caller only the routes it needs.
   - "Who obtained an access token" is logged by Hydra, not by our service, because tokens are issued at Hydra's token endpoint.
   - The login rate limit is counted per replica, in memory. With several replicas it needs a shared store.
   - Postgres is a single container and therefore a single point of failure.
   - The stack runs over plain HTTP locally, and there is no CI pipeline.
