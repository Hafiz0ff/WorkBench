# Phase 7 Architecture

## Final Shape

- Shared `EventEmitter` in `src/events.js` is the single bus for internal WorkBench events.
- `src/stats.js` emits `workbench:event` after fire-and-forget tracking succeeds.
- `src/hooks.js` subscribes to the emitter and dispatches shell, Telegram, and webhook hooks.
- `src/server.js` reuses the same event bus for SSE and exposes hooks API routes.
- `src/web/app.js` renders a Hooks section with list, toggle, test, and recent dispatch history.

## Security and Storage

- Shell hooks use `spawn()` with argv arrays, never `exec()`.
- Telegram secrets stay in `~/.workbench/secrets.json`.
- `policy.json` stores `@secret:key` references rather than plaintext tokens.
- Hook history and hook errors remain local-only operational files.
