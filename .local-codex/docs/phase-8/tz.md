# WorkBench Phase 8

## Multi-provider: OpenAI / Anthropic / Gemini

Goal: add native support for OpenAI, Anthropic Claude, and Google Gemini alongside Ollama through a single provider interface.

Key requirements:
- provider registry and factory
- per-provider config in `policy.json`
- fallback from the active provider to the configured backup provider for retryable failures
- CLI commands for provider listing, switching, health checks, model listing, and setup
- browser dashboard updates for provider selection and model selection
- keep API keys in `~/.workbench/secrets.json` via `@secret:key`

Acceptance:
- switch providers from CLI and dashboard
- stream and complete across all providers
- do not leak API keys through `/api/v1/providers`
- preserve Ollama behavior
