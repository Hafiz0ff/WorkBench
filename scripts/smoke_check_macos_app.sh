#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_APP=0
if [[ "${1:-}" == "--launch" ]]; then
  LAUNCH_APP=1
fi

"$ROOT/scripts/validate_macos_app.sh"

if [[ "$LAUNCH_APP" -eq 1 ]]; then
  PACKAGE_JSON="$ROOT/package.json"
  APP_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.productName)" "$ROOT/macos/LocalCodexMac/BundleMetadata.json")"
  EXECUTABLE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.executableName)" "$ROOT/macos/LocalCodexMac/BundleMetadata.json")"
  VERSION="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.version || '')" "$PACKAGE_JSON")"
  if [[ -z "$VERSION" ]]; then
    VERSION="0.1.0"
  fi
  APP_BUNDLE="$ROOT/dist/macos/$APP_NAME-$VERSION.app"
  open -gj "$APP_BUNDLE"
  sleep 5
  pgrep -x "$APP_NAME" >/dev/null || true
  printf 'App launched: %s\n' "$APP_BUNDLE"
fi
