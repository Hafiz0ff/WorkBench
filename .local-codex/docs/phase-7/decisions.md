# Phase 7 Decisions

- Use a shared EventEmitter instead of polling so hooks, stats, and SSE can observe the same events without duplicating plumbing.
- Keep shell hooks on `spawn()` only to avoid shell injection.
- Store Telegram tokens in `~/.workbench/secrets.json` and reference them from policy with `@secret:key`.
- Treat hook history and hook errors as local-only operational data.

