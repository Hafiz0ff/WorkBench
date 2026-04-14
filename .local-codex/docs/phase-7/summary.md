# Phase 7 Summary

Phase 7 adds event hooks for WorkBench and closes the loop between internal events, external notifications, and the browser dashboard.

What shipped:
- Shared event bus in `src/events.js`.
- Hook dispatch engine in `src/hooks.js`.
- Telegram setup flow with local secret storage.
- Shell and webhook hook channels.
- Hook API and dashboard section.
- Hook history and error log files in `.local-codex/`.
- CLI commands for listing, testing, enabling, disabling, and inspecting hooks.

Security notes:
- Shell hooks use `spawn()` only.
- Telegram tokens are stored outside the repo in `~/.workbench/secrets.json`.
- `policy.json` references secrets by key instead of storing plaintext credentials.
