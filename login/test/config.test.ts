import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/config.js";

const secret = "s".repeat(32);
const noFiles = (): string => {
  throw new Error("unexpected file read");
};

describe("loadConfig", () => {
  it("applies defaults for optional settings", () => {
    const config = loadConfig({ HYDRA_ADMIN_URL: "http://hydra:4445", COOKIE_SECRET: secret }, noFiles);

    expect(config).toMatchObject({ host: "0.0.0.0", port: 3000, logLevel: "info", hydraTimeoutMs: 5000 });
  });

  it("prefers a mounted secret file over the environment and trims it", () => {
    const fromFile = "f".repeat(32);
    const config = loadConfig(
      { HYDRA_ADMIN_URL: "http://hydra:4445", COOKIE_SECRET: secret, COOKIE_SECRET_FILE: "/run/secrets/x" },
      (path) => (path === "/run/secrets/x" ? `${fromFile}\n` : noFiles()),
    );

    expect(config.cookieSecret).toBe(fromFile);
  });

  it("reports every invalid key at once", () => {
    expect(() => loadConfig({ PORT: "70000", COOKIE_SECRET: "short" }, noFiles)).toThrowError(
      /port: .*hydraAdminUrl: .*cookieSecret: must be at least 32 characters/,
    );
  });

  it("does not leak secret values in the error", () => {
    expect(() => loadConfig({ HYDRA_ADMIN_URL: "http://hydra:4445", COOKIE_SECRET: "hunter2" }, noFiles)).toThrowError(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") }),
    );
  });

  it("fails clearly when the secret file is unreadable", () => {
    expect(() => loadConfig({ HYDRA_ADMIN_URL: "http://hydra:4445", COOKIE_SECRET_FILE: "/missing" }, noFiles)).toThrowError(
      new ConfigError("COOKIE_SECRET_FILE: cannot read /missing"),
    );
  });

  it("returns an immutable object", () => {
    const config = loadConfig({ HYDRA_ADMIN_URL: "http://hydra:4445", COOKIE_SECRET: secret }, noFiles);

    expect(Object.isFrozen(config)).toBe(true);
  });
});
