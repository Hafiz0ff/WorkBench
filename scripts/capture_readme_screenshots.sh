#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
package_root="$repo_root/macos/LocalCodexMac"

cd "$package_root"
GENERATE_README_SCREENSHOTS=1 swift test --filter ReadmeScreenshotTests/testGenerateReadmeScreenshots
