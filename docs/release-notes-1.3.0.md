# Workbench 1.3.0

Workbench 1.3.0 adds local analytics and usage statistics while keeping the project-first workflow intact.

## Highlights

- Local analytics in `.local-codex/events.jsonl` and `.local-codex/stats.json`
- New `app stats` commands for reporting, refresh, pruning, and export
- Analytics events wired into tasks, patches, tests, auto-runs, providers, and roles
- Stats section added to the browser dashboard with KPI cards and charts
- Fire-and-forget tracking so analytics never blocks core workflows

## Notes

- `stats.json` is a cache, not the source of truth
- Analytics are derived from local project data
- Tracking can be disabled in `policy.json`
