# WorkBench v2.1.0

Token Budget adds local token accounting, limits, and visualization on top of the existing WorkBench roadmap.

## What changed

- Added `.local-codex/token-usage.jsonl` and `.local-codex/budget-cache.json` for local usage tracking and cached aggregation.
- Added `app budget` CLI commands for reporting, limit management, export, pruning, and per-provider drill-down.
- Wired token tracking into providers, agent execution, auto mode, and conversation summaries.
- Added budget views to the local web dashboard with live SSE updates and stacked charts.
- Added budget limits and pricing controls to `policy.json` with warn/block behavior.

## Notes

- Ollama is counted as a real token consumer even though it has no billing cost.
- Budget tracking is fire-and-forget; failures never block the main workflow.
