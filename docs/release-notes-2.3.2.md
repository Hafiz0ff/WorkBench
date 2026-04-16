# WorkBench v2.3.2

**Current release.** This note summarizes the Freeze Mode release so the GitHub release page stays aligned with the latest shipped build.

## 2.3.2 - Freeze Mode

- Added a reversible Freeze Mode that marks the project as read-only for patch generation and file mutation.
- Added CLI commands for `app project freeze` and `app project unfreeze` with a persistent project toggle.
- Injected the required read-only instruction into prompt composition, planning, and step execution paths.
- Added audit-only execution so auto mode returns findings instead of staging or applying patches while Freeze Mode is active.
- Updated release metadata, changelog, and README links for the new version line.

## 2.3.1 - Intent-based micro-interactions

- Added shared spring motion presets and intent-aware button feedback in the SwiftUI client.
- Applied selection and reveal transitions to section swaps, banners, empty states, and status chips.
- Added pointer-aware press vectors, hover/active states, and reduced-motion fallbacks in the web dashboard.
- Fixed deterministic budget cache validation and ensured patch lifecycle events persist before returning.
