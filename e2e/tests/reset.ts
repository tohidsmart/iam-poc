import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Makes Hydra forget consent that a user chose to have remembered.
 *
 * Remembered consent is stored per user and client, not per browser, so one
 * run (or a manual click-through) would otherwise change what the next run
 * sees. The admin API is unreachable from the host by design, so this goes
 * through a one-off container on the admin network, as an operator would.
 */
export function forgetConsent(subject: string): void {
  const url = `http://hydra-admin:4445/admin/oauth2/auth/sessions/consent?subject=${encodeURIComponent(subject)}&all=true`;
  execFileSync(
    "docker",
    ["compose", "run", "--rm", "--no-deps", "--entrypoint", "curl", "client-bootstrap", "-sS", "--fail", "-X", "DELETE", url],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
}
