# Setup Notes

## Embeddings

Phase 10 uses Ollama embeddings by default.

If the local embedding model is missing, install it with:

```bash
ollama pull nomic-embed-text
```

If Ollama is unavailable, WorkBench can fall back to OpenAI embeddings when an
API key is configured in `~/.workbench/secrets.json` or exported as
`OPENAI_API_KEY` from a local `.env` file based on `.env.example`.
