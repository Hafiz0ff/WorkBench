#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT/package.json"
METADATA_JSON="$ROOT/macos/LocalCodexMac/BundleMetadata.json"
APP_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.productName)" "$METADATA_JSON")"
EXECUTABLE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.executableName)" "$METADATA_JSON")"
VERSION="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.version || '')" "$PACKAGE_JSON")"
if [[ -z "$VERSION" ]]; then
  VERSION="0.1.0"
fi
DMG_FILE="$ROOT/dist/macos/$APP_NAME-$VERSION.dmg"

"$ROOT/scripts/package_macos_dmg.sh"
hdiutil verify "$DMG_FILE"
printf 'Проверка DMG успешна: %s\n' "$DMG_FILE"
