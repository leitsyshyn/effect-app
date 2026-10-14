#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
server_url="${DRIVE_SERVER_URL:-http://localhost:3000}"
daemon_url="${SYNC_DAEMON_URL:-http://127.0.0.1:47821}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [[ "${1:-}" != "--offline" ]]; then
  echo "Fetching $server_url/api/openapi.json"
  curl -fsS "$server_url/api/openapi.json" | python3 -m json.tool --indent 2 > "$here/drive.json"
  echo "Fetching $daemon_url/openapi.json"
  curl -fsS "$daemon_url/openapi.json" | python3 -m json.tool --indent 2 > "$here/sync.json"
  echo "Fetching $server_url/api/auth/open-api/generate-schema"
  curl -fsS "$server_url/api/auth/open-api/generate-schema" > "$work/auth-full.json"
  python3 "$here/trim.py" "$work/auth-full.json" "$here/auth.json" /sign-in/email /sign-up/email /sign-out
fi

generate() {
  local spec="$1" module="$2"
  echo "Generating $module from $(basename "$spec")"
  python3 "$here/normalize.py" "$spec" "$work/$(basename "$spec")"
  swift run ${SWIFTPM_FLAGS:-} --package-path "$here/generator" swift-openapi-generator generate \
    "$work/$(basename "$spec")" \
    --config "$here/openapi-generator-config.yaml" \
    --output-directory "$root/Sources/$module"
}

generate "$here/drive.json" DriveAPI
generate "$here/sync.json" SyncAPI
generate "$here/auth.json" AuthAPI
