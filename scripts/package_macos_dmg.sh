#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT/package.json"
METADATA_JSON="$ROOT/macos/LocalCodexMac/BundleMetadata.json"
APP_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.productName)" "$METADATA_JSON")"
EXECUTABLE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.executableName)" "$METADATA_JSON")"
DMG_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.dmgVolumeName)" "$METADATA_JSON")"
VERSION="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.version || '')" "$PACKAGE_JSON")"
if [[ -z "$VERSION" ]]; then
  VERSION="0.1.0"
fi

"$ROOT/scripts/build_macos_app.sh"

DIST_DIR="$ROOT/dist/macos"
APP_BUNDLE="$DIST_DIR/$APP_NAME-$VERSION.app"
STAGING_DIR="$DIST_DIR/dmg-staging-$VERSION"
DMG_FILE="$DIST_DIR/$APP_NAME-$VERSION.dmg"

rm -rf "$STAGING_DIR" "$DMG_FILE"
mkdir -p "$STAGING_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --sign "$CODESIGN_IDENTITY" "$STAGING_DIR/$APP_NAME-$VERSION.app"
fi

hdiutil create -volname "$DMG_NAME" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_FILE"

printf 'Создан DMG: %s\n' "$DMG_FILE"
