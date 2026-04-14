# Phase 8 Decisions

1. Use `node:https` instead of provider SDKs to keep the runtime dependency-free and fully control SSE and retry handling.
2. Keep message conversion inside each provider adapter so `agent.js` can stay on one normalized `[{ role, content }]` format.
3. Store API keys in `~/.workbench/secrets.json` and reference them with `@secret:key` so secrets never live in the repo or vanish with shell sessions.
4. Bump the release line to `2.0.0` because this phase completes the full roadmap and changes the provider architecture in a breaking way.
