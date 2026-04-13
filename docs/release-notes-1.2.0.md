# Workbench 1.2.0

Workbench 1.2.0 adds a global workspace registry and makes multi-project switching first-class without changing the file-based source of truth.

## What changed

- Added `~/.workbench/workspaces.json` and `~/.workbench/config.json`
- Added `workbench add|list|switch|status|remove|rename|pin|tag|search|refresh|config|repair`
- Auto-registers projects when they are opened through CLI, GUI, drag & drop, or the local dashboard
- Adds a Workspaces section to the browser dashboard with snapshot metadata and live updates
- Keeps the current project state inspectable through `.local-codex/` while the registry acts as a convenience layer

## Workflow

- Add a project once
- Switch by alias afterward
- Pin the projects you return to most often
- Use tags to keep related work grouped
- Refresh snapshots when you want the registry to catch up with the live project state

## Notes

- The registry is a cache, not the source of truth
- Deleted folders stay visible as unavailable instead of crashing the UI
- `workbench repair` can rebuild the registry from existing projects with `.local-codex/`
