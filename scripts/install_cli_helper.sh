#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METADATA_JSON="$ROOT/macos/LocalCodexMac/BundleMetadata.json"
HELPER_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.helperName)" "$METADATA_JSON")"
INSTALL_DIR="${LOCALCODEX_BIN:-$HOME/.local/bin}"
TARGET="${1:-$INSTALL_DIR/$HELPER_NAME}"

if [[ "${1:-}" == "--uninstall" ]]; then
  shift || true
  TARGET="${1:-$INSTALL_DIR/$HELPER_NAME}"
  if [[ -e "$TARGET" ]]; then
    rm -f "$TARGET"
    printf 'Удалён helper: %s\n' "$TARGET"
  else
    printf 'Helper не найден: %s\n' "$TARGET"
  fi
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"
cat > "$TARGET" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "$ROOT/src/cli.js" "\$@"
EOF
chmod +x "$TARGET"

printf 'Установлен CLI helper: %s\n' "$TARGET"
printf 'Команда: %s\n' "$HELPER_NAME"
printf 'Удаление: rm -f %s\n' "$TARGET"

