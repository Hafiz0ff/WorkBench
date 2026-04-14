# Changelog

## 1.3.0
- Added local analytics and usage statistics in `.local-codex/events.jsonl` and `.local-codex/stats.json`.
- Added `app stats`, `app stats refresh`, `app stats prune`, and `app stats export`.
- Wired analytics events into tasks, patches, tests, auto-runs, providers, and roles.
- Added the Stats section to the browser dashboard with KPI cards and SVG charts.
- Updated the release line, README, and release notes for the analytics phase.

## 1.2.0
- Added a global workspace registry under `~/.workbench/` with aliases, pins, tags, snapshots, and repair flow.
- Added `workbench add|list|switch|status|remove|rename|pin|tag|search|refresh|config|repair`.
- Auto-registration now keeps the current project in sync when opening via CLI, GUI, drag & drop, or workspace switching.
- Added a Workspaces section to the browser dashboard with snapshot metadata and live updates.
- Updated the release line, README, and release notes for the multi-project workflow.

## 1.1.0
- Added an optional local web server and browser dashboard for tasks, memory, patches, tests, providers, and roles.
- Introduced SSE live updates plus server CLI commands for start, stop, status, and config.
- The dashboard works offline with vanilla HTML, CSS, and JS only.
- Added registry API surface and browser-friendly project views on top of the existing file-based workspace.

## 1.0.1
- Phase 3 landed: centralized test runner, CI loop, test history, and auto-with-tests patch handling.
- Added `app test` commands for running, inspecting, and detecting project test runners.
- Auto mode now writes structured run history and respects rollback behavior when tests fail.
- Updated the macOS GUI and CLI workflows to stay aligned with the file-based task and test state.

## 1.0.0
- First public release of Workbench.
- Russian-first macOS GUI with sidebar, tasks, roles, prompt inspector, patches, policy, session, settings, extensions, and registry views.
- Local Ollama-based CLI engine with project memory, roles, tasks, and task-aware prompt composition.
- Reviewable patch workflow with safe execution policy and approval modes.
- Manifest-driven GitHub extension installation with curated registry support and trust metadata.
- macOS packaging, DMG build flow, helper install flow, and release-hardening scripts.

## 0.1.0
- Initial local coding assistant CLI.
- Project memory, roles, tasks, patches, policy, and macOS GUI wrapper.
