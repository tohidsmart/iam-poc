import type { FastifyInstance } from "fastify";
import { buildApiApp, buildClientApp } from "./app.js";
import { HttpApiCaller } from "./client-routes.js";
import { HydraIntrospector } from "./hydra-introspector.js";
import { HydraTokenClient } from "./hydra-token-client.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value.replace(/\/+$/, "");
}

const logger = { level: process.env.LOG_LEVEL ?? "info" };

// One image, two roles. Each role reads only the settings it needs, so the
// client container is never given the admin API's address.
async function build(role: string): Promise<FastifyInstance> {
  if (role === "api") {
    return buildApiApp({
      introspector: new HydraIntrospector({ adminUrl: required("HYDRA_ADMIN_URL"), timeoutMs: 5000 }),
      logger,
    });
  }
  if (role === "client") {
    const baseUrl = required("BASE_URL");
    const clientId = required("CLIENT_ID");
    return buildClientApp({
      tokens: new HydraTokenClient({
        publicUrl: required("HYDRA_PUBLIC_URL"),
        clientId,
        redirectUri: `${baseUrl}/callback`,
      }),
      api: new HttpApiCaller(required("API_URL")),
      client: {
        clientId,
        hydraBrowserUrl: required("HYDRA_BROWSER_URL"),
        baseUrl,
        apiBrowserUrl: required("API_BROWSER_URL"),
        scopes: ["openid", "profile", "email", "offline_access", "api:read"],
      },
      logger,
    });
  }
  console.error('ROLE must be "api" or "client"');
  process.exit(1);
}

const app = await build(required("ROLE"));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}

await app.listen({ host: process.env.HOST ?? "0.0.0.0", port: Number(process.env.PORT ?? 4000) });
