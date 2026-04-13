#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-${APP_PATH:-}}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-}"
ENTITLEMENTS_PATH="${ENTITLEMENTS_PATH:-}"

if [[ -z "${APP_PATH}" || -z "${SIGNING_IDENTITY}" ]]; then
  echo "Usage: APP_PATH=/path/to.app SIGNING_IDENTITY='Developer ID Application: ...' [$0 /path/to.app]" >&2
  echo "Optional: ENTITLEMENTS_PATH=/path/to/entitlements.plist" >&2
  exit 1
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found: ${APP_PATH}" >&2
  exit 1
fi

CMD=(xcrun codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}")
if [[ -n "${ENTITLEMENTS_PATH}" ]]; then
  if [[ ! -f "${ENTITLEMENTS_PATH}" ]]; then
    echo "Entitlements file not found: ${ENTITLEMENTS_PATH}" >&2
    exit 1
  fi
  CMD+=(--entitlements "${ENTITLEMENTS_PATH}")
fi
CMD+=("${APP_PATH}")

"${CMD[@]}"
xcrun codesign --verify --strict --verbose=2 "${APP_PATH}"
