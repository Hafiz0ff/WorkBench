# WorkBench - Phase 6

## Analytics and Usage Statistics

This phase adds local analytics for tasks, patches, tests, providers, roles, and auto-runs.
The implementation stores raw events in `.local-codex/events.jsonl` and aggregated data in `.local-codex/stats.json`.

### Requirements

- Fire-and-forget `trackEvent()` behavior
- `app stats` terminal reporting
- `app stats refresh|prune|export`
- Browser dashboard stats section with KPI cards and SVG charts
- Analytics configuration in `policy.json`
- No remote analytics services

### Documentation rules

- Keep phase artifacts in `.local-codex/docs/phase-6/`
- Update `architecture.md` after implementation steps
- Write `summary.md` and `test-report.md` at the end of the phase
