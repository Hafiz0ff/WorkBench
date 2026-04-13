# Workbench 1.1.0

Workbench 1.1.0 adds an optional local web dashboard on top of the existing CLI and macOS GUI.

## Highlights

- Local HTTP dashboard with read-mostly browser views for tasks, patches, tests, memory, providers, roles, and registry state
- SSE live updates so the browser reacts to project changes without polling
- New `app server start|stop|status|config` commands
- Offline-first frontend with built-in HTML, CSS, and vanilla JavaScript only
- API surface that stays grounded in the inspectable `.local-codex/` workspace

## What changed

- Added `src/server.js` as a thin Node HTTP server around the existing WorkBench modules
- Added `src/web/index.html`, `src/web/style.css`, and `src/web/app.js`
- Added server CLI support and configuration entries in `policy.json`
- Added API endpoints for project, tasks, patches, tests, providers, roles, registry, and SSE events
- Added tests for the server API and server CLI commands

## Release notes

- The dashboard is optional and local-only by default.
- No frontend framework or CDN dependency was introduced.
- Existing CLI workflows remain unchanged.
- The macOS app and the CLI continue to share the same file-based source of truth.

## Verification

- `npm test`
- `cd macos/LocalCodexMac && swift test`
- `./scripts/release_candidate_smoke.sh`
