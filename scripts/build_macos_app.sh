#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT/package.json"
METADATA_JSON="$ROOT/macos/LocalCodexMac/BundleMetadata.json"
APP_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.productName)" "$METADATA_JSON")"
EXECUTABLE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.executableName)" "$METADATA_JSON")"
BUNDLE_ID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.bundleIdentifier)" "$METADATA_JSON")"
DMG_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.dmgVolumeName)" "$METADATA_JSON")"
VERSION="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.version || '')" "$PACKAGE_JSON")"
if [[ -z "$VERSION" ]]; then
  VERSION="0.1.0"
fi

BUILD_ROOT="$ROOT/macos/LocalCodexMac"
DIST_DIR="$ROOT/dist/macos"
APP_BUNDLE="$DIST_DIR/$APP_NAME-$VERSION.app"
ICONSET_DIR="$DIST_DIR/$APP_NAME.iconset"
ICNS_FILE="$DIST_DIR/$APP_NAME.icns"
EXECUTABLE=""

rm -rf "$APP_BUNDLE" "$ICONSET_DIR" "$ICNS_FILE"
mkdir -p "$DIST_DIR"

(
  cd "$BUILD_ROOT"
  swift build -c release
)

BIN_DIR="$(cd "$BUILD_ROOT" && swift build -c release --show-bin-path)"

if [[ ! -x "$EXECUTABLE" ]]; then
  EXECUTABLE="$BIN_DIR/$EXECUTABLE_NAME"
fi

if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Не найден release binary: $EXECUTABLE" >&2
  exit 1
fi

swift "$ROOT/scripts/generate_app_icon.swift" "$ICONSET_DIR"
iconutil -c icns "$ICONSET_DIR" -o "$ICNS_FILE"

mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$EXECUTABLE" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
chmod +x "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"

RESOURCES_BUNDLE="$BIN_DIR/${EXECUTABLE_NAME}_${EXECUTABLE_NAME}.bundle"
if [[ -d "$RESOURCES_BUNDLE" ]]; then
cp -R "$RESOURCES_BUNDLE" "$APP_BUNDLE/"
else
  echo "Не найден resource bundle для GUI." >&2
  exit 1
fi

cp "$ICNS_FILE" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
printf '%s\n' "$ROOT" > "$APP_BUNDLE/Contents/Resources/engine-root.txt"

cat > "$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>ru</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>NSHumanReadableCopyright</key>
  <string>Workbench</string>
</dict>
</plist>
EOF

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --sign "$CODESIGN_IDENTITY" "$APP_BUNDLE"
fi

printf 'Собрано приложение: %s\n' "$APP_BUNDLE"
printf 'Версия: %s\n' "$VERSION"
printf 'Bundle ID: %s\n' "$BUNDLE_ID"
printf 'Volume name: %s\n' "$DMG_NAME"
