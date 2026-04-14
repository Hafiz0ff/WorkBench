# Phase 8 Architecture

## Step 1
- Created the phase-8 documentation folder and registered the phase in `index.md`.

## Step 2
- Added shared HTTP helpers for JSON and SSE requests.

## Step 3
- Implemented provider adapters for OpenAI, Anthropic, Gemini, and Ollama on the same interface.

## Step 4
- Added the provider registry, fallback flow, secret resolution, and active-model updates in project state.

## Step 5
- Wired `agent.js` to the provider registry so it can complete requests and emit fallback events.

## Step 6
- Extended the CLI with provider list, health, models, setup, fallback, and switch flows.

## Step 7
- Updated the web dashboard provider section to expose active provider and model selection.

## Step 8
- Finalized release documentation and versioning for WorkBench 2.0.0.
