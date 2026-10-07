#!/usr/bin/env bash
# Generates local secrets into ./secrets (gitignored). Idempotent: existing
# files are kept, so re-running never rotates a secret by accident.
# Rotating secrets.system or the pairwise salt has consequences — see README.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p secrets
chmod 700 secrets

rand() { openssl rand -hex 32; }

# Containers run as non-root users with differing uids, and compose bind-mounts
# file secrets with host permissions, so files must be world-readable. The 0700
# directory is what keeps other host users out.
write_once() {
  local file="secrets/$1"
  if [[ -e "$file" ]]; then
    echo "kept     $file"
    return
  fi
  (umask 022 && cat > "$file")
  echo "created  $file"
}

[[ -e secrets/postgres_password ]] || rand | tr -d '\n' | write_once postgres_password
pg_password="$(cat secrets/postgres_password)"

# Kept apart from hydra.secrets.yml so the database password can be changed
# without regenerating the system secret or the pairwise salt.
write_once hydra.dsn.yml <<YAML
dsn: postgres://hydra:${pg_password}@postgresd:5432/hydra?sslmode=disable&max_conns=20&max_idle_conns=4
YAML

write_once hydra.secrets.yml <<YAML
secrets:
  # A list: the first entry signs and encrypts, later entries still verify and
  # decrypt. Rotate by prepending.
  system:
    - $(rand)

oidc:
  subject_identifiers:
    pairwise:
      # Cannot be rotated: changing it changes every user's pairwise subject.
      salt: $(rand)
YAML

[[ -e secrets/login_cookie_secret ]] || rand | tr -d '\n' | write_once login_cookie_secret
