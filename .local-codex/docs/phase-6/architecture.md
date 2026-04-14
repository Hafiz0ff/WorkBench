# Phase 6 Architecture

## Step 1 - Documentation bootstrap

- Created the `phase-6/` documentation workspace.
- Stored the phase brief in `tz.md`.
- Marked the phase as in progress in the phase index.

## Step 2 - Analytics core

- Added `src/stats.js` as the single aggregation module for analytics.
- Stored raw analytics events in `.local-codex/events.jsonl`.
- Stored cached aggregated statistics in `.local-codex/stats.json`.
- Kept event tracking fire-and-forget so analytics never blocks core commands.

## Step 3 - Event integration

- Wired analytics events into tasks, patches, tests, auto-runs, providers, and roles.
- Added test-run telemetry and provider token usage tracking.
- Kept stats aggregation derived from local files instead of introducing a database.

## Step 4 - CLI and dashboard

- Added `app stats`, `app stats refresh`, `app stats prune`, and `app stats export`.
- Added the Stats section to the browser dashboard with KPI cards and SVG charts.
- Exposed stats through the local HTTP API for dashboard consumption.

## Step 5 - Release updates

- Updated README and release notes for the analytics workflow.
- Bumped the release line for the phase-6 deliverable.
- Kept analytics local-only and inspectable on disk.
