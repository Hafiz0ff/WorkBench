#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-${APP_PATH:-}}"
APPLE_ID="${APPLE_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:-}"
NOTARYTOOL_PROFILE="${NOTARYTOOL_PROFILE:-}"
ZIP_PATH="${ZIP_PATH:-}"

if [[ -z "${APP_PATH}" ]]; then
  echo "Usage: APP_PATH=/path/to.app [$0 /path/to.app]" >&2
  echo "Provide either NOTARYTOOL_PROFILE or APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD." >&2
  exit 1
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found: ${APP_PATH}" >&2
  exit 1
fi

if [[ -z "${ZIP_PATH}" ]]; then
  BASE_NAME="$(basename "${APP_PATH}" .app)"
  ZIP_PATH="$(dirname "${APP_PATH}")/${BASE_NAME}.zip"
fi

rm -f "${ZIP_PATH}"
ditto -c -k --keepParent "${APP_PATH}" "${ZIP_PATH}"

if [[ -n "${NOTARYTOOL_PROFILE}" ]]; then
  xcrun notarytool submit "${ZIP_PATH}" --wait --keychain-profile "${NOTARYTOOL_PROFILE}"
else
  if [[ -z "${APPLE_ID}" || -z "${APPLE_TEAM_ID}" || -z "${APPLE_APP_PASSWORD}" ]]; then
    echo "Missing notarization credentials." >&2
    exit 1
  fi
  xcrun notarytool submit "${ZIP_PATH}" --wait --apple-id "${APPLE_ID}" --team-id "${APPLE_TEAM_ID}" --password "${APPLE_APP_PASSWORD}"
fi
