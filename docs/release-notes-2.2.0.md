# WorkBench v2.2.0

**Vector search and semantic memory**

## What changed

- Added local vector indexing for project memory and source code.
- Added semantic search and automatic context enrichment for the agent.
- Added CLI commands for building, updating, dropping, rebuilding, and querying the index.
- Added dashboard support for index status, rebuild actions, and search results.
- Added Ollama/OpenAI embedding selection with fallback.

## Notes

- The index is local and derived; it can be rebuilt from source at any time.
- Ollama `nomic-embed-text` remains the preferred embedding model.
