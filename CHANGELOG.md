# Changelog

## 2.3.0
- Added the Extension SDK with plugin manifests, hook runners, permission-guarded APIs, and custom commands.
- Added `app extensions scaffold|info|enable|disable|remove` plus `app ext <command>` dispatch for plugin commands.
- Added plugin dashboard coverage, API routes, developer docs, and example extensions.
- Bumped the release line for the plugin system phase.

## 2.2.0
- Added semantic vector search over project memory and source code with local file-backed indexes.
- Added `app index` and `app search` commands plus dashboard integration for index status and search.
- Wired vector index refresh into project refresh and patch application flows.
- Added phase 10 docs and release notes for the vector search release.

## 2.1.0
- Added Token Budget tracking with local usage logs, cached aggregation, and per-provider/per-model reporting.
- Introduced CLI budget commands for reporting, exporting, pruning, and adjusting token limits.
- Added budget charts and live usage views to the web dashboard with SSE updates.
- Wired budget checks and usage tracking into agent, auto mode, provider completion, and summary generation flows.

## 2.0.0
- Final release of the roadmap: Ollama, OpenAI, Anthropic, and Gemini now share a unified provider registry and fallback flow.
- Added per-provider model selection, health checks, and secret-backed API key storage.
- Phase 8 closed the multi-provider story and bumped the release line to WorkBench 2.0.0.

## 1.4.0
- Added event hooks with shell, Telegram, and webhook channels.
- Introduced shared event emitter wiring for stats, hooks, and SSE.
- Added hooks API, dashboard section, and Telegram secret storage flow.
- Documented Phase 7 and updated the release line for hooks support.

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
