#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LOCAL_CODEX_ENGINE_ROOT="$ROOT"
export SWIFT_PACKAGE_ROOT="$ROOT/macos/LocalCodexMac"

cd "$SWIFT_PACKAGE_ROOT"
swift run LocalCodexMac
