#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT/package.json"
APP_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.productName)" "$ROOT/macos/LocalCodexMac/BundleMetadata.json")"
EXECUTABLE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.executableName)" "$ROOT/macos/LocalCodexMac/BundleMetadata.json")"
VERSION="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.version || '')" "$PACKAGE_JSON")"
if [[ -z "$VERSION" ]]; then
  VERSION="0.1.0"
fi
APP_BUNDLE="$ROOT/dist/macos/$APP_NAME-$VERSION.app"

if [[ ! -d "$APP_BUNDLE" ]]; then
  "$ROOT/scripts/build_macos_app.sh"
fi

open "$APP_BUNDLE"
