import { buildClientApp, type ClientDependencies } from "../src/app.js";
import type { ClientSettings } from "../src/client-routes.js";

export const client: ClientSettings = {
  clientId: "demo-app",
  hydraBrowserUrl: "http://hydra.browser",
  baseUrl: "http://app.test",
  apiBrowserUrl: "http://api.test",
  scopes: ["openid", "profile", "api:read"],
};

export const createClientApp = (overrides: Partial<ClientDependencies> = {}) =>
  buildClientApp({
    tokens: {
      exchange: async () => {
        throw new Error("unexpected token exchange");
      },
    },
    api: { getMe: async () => ({ status: 200, body: "{}" }) },
    client,
    ...overrides,
  });
