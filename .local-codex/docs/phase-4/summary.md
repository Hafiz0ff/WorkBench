# Phase 4 Summary

Phase 4 added an optional local web dashboard and server control surface for WorkBench without changing the existing file-based source of truth.

The release line moved to `1.1.0` to reflect the new browser-facing dashboard and server commands.

## Delivered

- Added `app server start|stop|status|config`
- Added `src/server.js` with JSON API endpoints and SSE live updates
- Added a browser dashboard in `src/web/` with task, patch, test, memory, provider, role, and registry views
- Added Basic Auth and localhost-first defaults for safer local usage
- Added server tests and CLI tests for the new flow
- Updated README, changelog, and release notes for the `1.1.0` release line

## Files changed

- `src/server.js`
- `src/web/index.html`
- `src/web/style.css`
- `src/web/app.js`
- `src/cli.js`
- `src/i18n/ru.json`
- `src/i18n/en.json`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `docs/release-notes-1.1.0.md`
- `.local-codex/docs/index.md`

## Verification

- `npm test` - 76 passed, 0 failed
- `cd macos/LocalCodexMac && swift test` - 16 passed, 1 skipped, 0 failed
- `./scripts/release_candidate_smoke.sh` - 10 steps evaluated, 0 failed

## Notes

- The dashboard is optional and works entirely offline.
- No frontend framework was introduced.
- SSE was used instead of polling to keep the browser live and lightweight.
