# Workbench 1.0.1

Workbench 1.0.1 focuses on the CI loop and test-runner foundation added in Phase 3.

## Highlights

- Added a dedicated `test-runner` module with structured test execution, history, and detection.
- Introduced `app test run`, `app test history`, `app test show`, `app test detect`, and `app test config`.
- Wired `app patch apply` and auto mode into the test runner with rollback-aware behavior.
- Added `auto-with-tests` approval mode for safer patch application.
- Kept test history inspectable on disk through `.local-codex/test-runs.jsonl` and per-run log files.

## User-facing changes

- Patch application now reports test execution results and rollback outcomes more clearly.
- Auto mode writes run metadata that can be resumed, inspected, and exported later.
- README, changelog, and Phase 3 documentation were updated to match the new workflow.

## Release notes

- Version bump: `1.0.1`
- Phase 3 status: completed
- The CLI and GUI continue to share the same filesystem-based project state.
