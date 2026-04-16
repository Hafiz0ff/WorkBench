# WorkBench v2.3.1

**Current release.** This note summarizes the motion and validation pass that followed `2.3.0`, so the release page stays aligned with the latest shipped build.

## 2.3.1 - Intent-based micro-interactions

- Added shared spring motion presets and intent-aware button feedback in the SwiftUI client.
- Applied selection and reveal transitions to section swaps, banners, empty states, and status chips.
- Added pointer-aware press vectors, hover/active states, and reduced-motion fallbacks in the web dashboard.
- Fixed deterministic budget cache validation and ensured patch lifecycle events persist before returning.

## 2.3.0 - Extension SDK and plugin system

- Added the Extension SDK with global and local plugin loading.
- Added permission-guarded plugin APIs for memory, code, notes, and namespaced events.
- Added plugin hooks for task, prompt, patch, search, stats, and index flows.
- Added custom plugin commands exposed through `app ext <command>`.
- Added browser dashboard coverage, server routes, developer docs, and example plugins.
