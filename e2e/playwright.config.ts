import { defineConfig } from "@playwright/test";

// Runs against the compose stack, which must already be up:
//   ./scripts/setup.sh && docker compose up -d --build --wait
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  // One worker: the tests share the login rate limit of the running service.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DEMO_CLIENT_URL ?? "http://127.0.0.1:5555",
    trace: "retain-on-failure",
    // `npm run e2e:headed` shows the browser and slows each action so it can be followed.
    launchOptions: { slowMo: Number(process.env.SLOW_MO ?? 0) },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
