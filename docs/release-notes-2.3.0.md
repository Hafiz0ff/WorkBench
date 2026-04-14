# WorkBench v2.3.0

**Current release.** This note summarizes the full path from `1.0.0` to `2.3.0`, so the GitHub release page shows the complete product evolution in one place.

## 2.3.0 - Extension SDK and plugin system

- Added the Extension SDK with global and local plugin loading.
- Added permission-guarded plugin APIs for memory, code, notes, and namespaced events.
- Added plugin hooks for task, prompt, patch, search, stats, and index flows.
- Added custom plugin commands exposed through `app ext <command>`.
- Added browser dashboard coverage, server routes, developer docs, and example plugins.

## 2.2.0 - Vector search and semantic memory

- Added local vector indexes for project memory and source code.
- Added `app index` and `app search` commands plus dashboard support for semantic search.
- Wired incremental index refresh into project refresh and patch application flows.

## 2.1.0 - Token budget and usage tracking

- Added token usage tracking for all providers, including Ollama.
- Added budget limits, history, pruning, export, and CLI reporting.
- Added budget charts and live usage views to the web dashboard.

## 2.0.0 - Multi-provider runtime

- Unified Ollama, OpenAI, Anthropic, and Gemini under one provider registry.
- Added per-provider model selection, health checks, and secret-backed API key storage.
- Added fallback handling for retryable provider failures.

## 1.4.0 - Event hooks and notifications

- Added shell, Telegram, and webhook hooks on top of the shared event bus.
- Added secure Telegram secret storage outside the repo.
- Added hooks coverage to the CLI and web dashboard.

## 1.3.0 - Analytics and statistics

- Added local analytics event tracking in `.local-codex/events.jsonl` and `.local-codex/stats.json`.
- Added `app stats`, refresh, prune, and export commands.
- Added the Stats section to the browser dashboard.

## 1.2.0 - Workspace registry

- Added a global workspace registry under `~/.workbench/`.
- Added fast project switching, aliases, pins, tags, and repair flow.
- Added Workspaces coverage to the browser dashboard.

## 1.1.0 - Local web dashboard

- Added an optional local web server and browser dashboard.
- Added SSE live updates and server commands for start, stop, status, and config.
- Kept the dashboard offline-first with vanilla HTML, CSS, and JS.

## 1.0.1 - CI loop and test runner

- Added the centralized test runner and CI loop.
- Added `app test` commands for running, inspecting, and detecting project test runners.
- Added `auto-with-tests` behavior for patch application.

## 1.0.0 - First public release

- Russian-first macOS GUI with project, tasks, roles, prompt inspector, patches, policy, session, settings, extensions, and registry views.
- Local Ollama-based CLI engine with project memory, roles, tasks, and prompt composition.
- Reviewable patch workflow with safe execution policy and approval modes.
- Manifest-driven GitHub extension installation with curated registry support.
- macOS packaging, DMG build flow, helper install flow, and release-hardening scripts.
