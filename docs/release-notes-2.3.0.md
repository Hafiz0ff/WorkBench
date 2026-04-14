# WorkBench v2.3.0

**Extension SDK and plugin system**

## What changed

- Added the Extension SDK with global and local plugin loading.
- Added permission-guarded plugin APIs for memory, code, notes, and namespaced events.
- Added plugin hooks for task, prompt, patch, search, stats, and index flows.
- Added custom plugin commands exposed through `app ext <command>`.
- Added browser dashboard coverage, server routes, developer docs, and example plugins.

## Notes

- Local plugins override global plugins by name.
- Hook failures are isolated and do not stop the WorkBench core flow.
- `docs/extension-api.md` describes the plugin surface for extension authors.
