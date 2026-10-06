#!/bin/sh
# Registers every OAuth2 client described in /clients/*.json with Hydra.
# Declarative and idempotent: the JSON file is the source of truth, so a client
# is created when missing and overwritten when it already exists.
set -eu

admin="${HYDRA_ADMIN_URL:?HYDRA_ADMIN_URL is required}"

# The Hydra image has no healthcheck to wait on, so wait here until it is ready.
curl -sS -o /dev/null --fail --retry 30 --retry-delay 1 --retry-all-errors "$admin/health/ready"

for file in /clients/*.json; do
  id="$(sed -n 's/.*"client_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file")"
  [ -n "$id" ] || { echo "$file: no client_id" >&2; exit 1; }

  status="$(curl -sS -o /dev/null -w '%{http_code}' "$admin/admin/clients/$id")"
  case "$status" in
    200) method=PUT;  url="$admin/admin/clients/$id"; verb=updated ;;
    404) method=POST; url="$admin/admin/clients";     verb=created ;;
    *)   echo "$id: unexpected status $status from Hydra" >&2; exit 1 ;;
  esac

  curl -sS --fail-with-body -o /dev/null -X "$method" "$url" \
    -H 'content-type: application/json' --data-binary "@$file"
  echo "$verb client $id"
done
