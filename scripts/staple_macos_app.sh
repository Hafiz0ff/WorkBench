#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-${APP_PATH:-}}"

if [[ -z "${APP_PATH}" ]]; then
  echo "Usage: APP_PATH=/path/to.app [$0 /path/to.app]" >&2
  exit 1
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found: ${APP_PATH}" >&2
  exit 1
fi

xcrun stapler staple "${APP_PATH}"
xcrun stapler validate "${APP_PATH}"
