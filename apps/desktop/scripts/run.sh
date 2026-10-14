#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

swift build
binary="$(swift build --show-bin-path)/EffectDrive"

identity="${EFFECTDRIVE_SIGN_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  identity="$(security find-identity -v -p codesigning | awk 'NR == 1 && $2 ~ /^[0-9A-F]{40}$/ { print $2 }')"
fi

if [[ -n "$identity" ]]; then
  codesign --force --sign "$identity" --identifier com.effectdrive.desktop "$binary"
else
  echo "warning: no code-signing identity found; running ad-hoc signed (the Keychain will ask after each rebuild)." >&2
fi

exec "$binary" "$@"
