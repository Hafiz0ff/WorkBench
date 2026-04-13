# Phase 4 Decisions

- Use a built-in Node HTTP server and local static assets instead of introducing a frontend framework.
- Keep the web dashboard offline-first and derived entirely from existing `.local-codex/` state.
- Prefer SSE for live updates so the browser can react to task, patch, and test changes without polling.
- Expose only safe, predefined write actions through the API and avoid arbitrary command execution.
- Keep provider secrets local by returning provider metadata without API keys.
- Treat the browser dashboard as an optional companion surface, not a replacement for the CLI or macOS app.
