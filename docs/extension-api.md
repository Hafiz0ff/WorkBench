# WorkBench Extension API

## Quick Start

```bash
app extensions scaffold my-plugin --hooks pre-patch
```

Each extension lives in a directory with:

- `workbench.json` - required manifest
- `index.js` - entry point exporting `register(api)`
- `package.json` - optional standard package metadata

## Lifecycle

1. WorkBench scans global extensions from `~/.workbench/extensions/`.
2. WorkBench scans local extensions from `.local-codex/extensions/`.
3. The loader validates each manifest and checks `minWorkbenchVersion`.
4. `register(api)` runs for enabled plugins.
5. Hooks run in load order and stop when a handler sets `abort: true`.

## Hooks

| Hook | Context |
|------|---------|
| `pre-task` | `{ taskId, prompt, mode, projectRoot }` |
| `post-task` | `{ taskId, prompt, result, patchesApplied, durationMs }` |
| `pre-patch` | `{ taskId, patch, patchIndex }` |
| `post-patch` | `{ taskId, patch, patchIndex, success }` |
| `pre-prompt` | `{ messages, provider, model, taskId }` |
| `post-response` | `{ content, provider, model, usage, taskId }` |
| `memory-read` | `{ query, results, source }` |
| `index-update` | `{ target, stats }` |
| `on-event` | `{ type, payload }` |

## Plugin API

- `api.on(name, handler)` - register a lifecycle hook.
- `api.registerCommand(name, handler)` - add a custom CLI command.
- `api.memory.getNotes()` / `getTasks()` / `getDocs()` / `search()`
- `api.code.search()` / `readFile()`
- `api.notes.append()` / `write()`
- `api.events.emit()` - only the `workbench:plugin:*` namespace.
- `api.log()` / `api.warn()` / `api.error()` - prefixed logging.

## Permissions

| Permission | Opens |
|------------|-------|
| `read-memory` | `api.memory.*` |
| `read-code` | `api.code.*` |
| `write-notes` | `api.notes.*` |
| `*` | all guarded methods |

## Examples

### Prettier formatter

See `docs/examples/prettier-patch/` for a `pre-patch` plugin that rewrites
`ctx.patch.after`.

### Task logger

See `docs/examples/task-logger/` for a `post-task` plugin that appends a note.

### Prompt injector

See `docs/examples/prompt-injector/` for a `pre-prompt` plugin that injects
extra system context.

## Errors and debugging

- Missing permissions throw `PluginPermissionError`.
- Hook errors are isolated and logged per plugin.
- Use `app extensions info <id>` and the dashboard extensions panel to inspect
  active plugins, permissions, and counters.
