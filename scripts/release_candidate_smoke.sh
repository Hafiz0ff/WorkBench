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

APP_BUNDLE="$ROOT/dist/macos/$APP_NAME-$VERSION.app"

steps_total=0
steps_failed=0

print_step() {
  local status="$1"
  local label="$2"
  local details="${3:-}"
  steps_total=$((steps_total + 1))
  if [[ -n "$details" ]]; then
    printf '[%s] %s - %s\n' "$status" "$label" "$details"
  else
    printf '[%s] %s\n' "$status" "$label"
  fi
  if [[ "$status" == "FAIL" ]]; then
    steps_failed=$((steps_failed + 1))
  fi
}

run_check() {
  local label="$1"
  shift
  if "$@"; then
    print_step "PASS" "$label"
  else
    print_step "FAIL" "$label"
  fi
}

printf 'Workbench release-candidate smoke check\n'
printf 'Version: %s\n' "$VERSION"
printf 'App bundle: %s\n' "$APP_BUNDLE"
printf '\n'

if [[ ! -d "$APP_BUNDLE" ]]; then
  print_step "WARN" "App bundle missing" "building a fresh copy first"
  "$ROOT/scripts/build_macos_app.sh"
fi

run_check "App bundle exists" test -d "$APP_BUNDLE"
run_check "App executable exists" test -x "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
run_check "App icon exists" test -f "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
run_check "App info plist exists" test -f "$APP_BUNDLE/Contents/Info.plist"

if open "$APP_BUNDLE"; then
  print_step "PASS" "Launch request sent" "open returned success"
else
  print_step "FAIL" "Launch request sent" "open returned an error"
fi

sleep 2
if pgrep -f "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME" >/dev/null 2>&1; then
  print_step "PASS" "App process observed" "GUI process is running"
else
  print_step "WARN" "App process not observed" "this can happen outside an interactive GUI session"
fi

run_check "CLI validation" "$ROOT/scripts/validate_macos_app.sh"
run_check "GUI validation" "$ROOT/scripts/validate_macos_gui.sh"
run_check "Package validation" "$ROOT/scripts/validate_macos_package.sh"

printf '\nSmoke checklist summary:\n'
printf '%s\n' '- App launch attempted'
printf '%s\n' '- CLI validation run'
printf '%s\n' '- GUI validation run'
printf '%s\n' '- Package validation run'
printf '%s\n' "- Steps evaluated: $steps_total"
printf '%s\n' "- Failed steps: $steps_failed"

if [[ "$steps_failed" -gt 0 ]]; then
  exit 1
fi
