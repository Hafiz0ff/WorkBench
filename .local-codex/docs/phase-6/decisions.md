# Phase 6 Decisions

- Analytics are stored locally and derived from source files and event logs.
- `stats.json` is a cache, not a source of truth.
- `trackEvent()` is best-effort and must not block core workflows.
- Provider token tracking is optional and respects privacy settings.
- The dashboard reads stats through the local API instead of duplicating aggregation logic in the browser.
