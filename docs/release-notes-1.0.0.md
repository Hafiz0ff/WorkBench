# Workbench 1.0.0

Release date: 2026-04-13

## Highlights

- First public release of Workbench.
- Russian-first macOS app with CLI and native SwiftUI GUI.
- Project memory, roles, tasks, patches, policy, session console, extensions, and registry support.
- Safe execution model with reviewable diffs and explicit approval modes.
- Local Ollama integration with task-aware prompt composition.

## CLI

- `app start`
- `app project init|status|refresh|summary`
- `app roles list|show|use|current|create|edit|scaffold`
- `app task create|list|show|current|use|plan|note|done|archive`
- `app prompt inspect`
- `app diff`
- `app patch apply|reject|status`
- `app extensions install|list|show|inspect|update|enable|disable|remove|doctor`
- `app registry list|show|add-source|remove-source|refresh|install`

## GUI

- Native macOS SwiftUI sidebar/detail app.
- Project, tasks, roles, prompt inspector, patches, policy, session, settings, extensions, and registry views.
- Russian-first UI labels, status states, and empty states.
- App bundle and DMG build workflow for macOS release preparation.

## Extensions / Registry

- Manifest-driven GitHub installs with no arbitrary install script execution.
- Curated registry catalog with trust metadata and compatibility checks.
- Disabled extensions remain visible on disk until manually enabled.

## Safety / Release

- Reviewable patch workflow instead of blind file overwrites.
- Policy-driven command execution with approval modes.
- Signing, notarization, stapling, and Gatekeeper validation scripts are documented and ready for environment-based release use.

## Notes

- Internal identifiers such as `app`, `LocalCodexMac`, and `.local-codex/` remain unchanged for compatibility.
- Public product branding is `Workbench`.
