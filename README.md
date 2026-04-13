# Workbench

Workbench is a local coding assistant for macOS powered by Ollama. It combines a terminal-first CLI, a native SwiftUI app, project memory, task tracking, safe patch application, and an inspectable extension system.

Workbench - локальный coding assistant для macOS на базе Ollama. Он сочетает CLI, native SwiftUI app, память проекта, задачи, безопасные патчи и inspectable extension system.

## Highlights / Возможности

- Local Ollama integration over `http://localhost:11434`
- Russian-first CLI and GUI by default
- Native macOS SwiftUI wrapper over the same filesystem-based engine
- Project memory, role profiles, task workspace, and prompt composition
- Reviewable patch workflow with approval modes and policy-driven execution
- Manifest-driven GitHub extensions with a curated registry layer
- Inspectable on-disk state in `.local-codex/`

- Интеграция с локальным Ollama через `http://localhost:11434`
- Русский интерфейс по умолчанию в CLI и GUI
- Native macOS SwiftUI оболочка поверх того же filesystem-based engine
- Память проекта, профили ролей, task workspace и сборка prompt
- Reviewable patch workflow с approval modes и policy-driven execution
- Manifest-driven GitHub extensions и curated registry layer
- Полностью inspectable состояние на диске в `.local-codex/`

## Quick Start / Быстрый старт

### Requirements / Требования

- Node.js 20+
- Ollama running locally
- A downloaded model, for example `qwen2.5-coder:14b`

- Node.js 20+
- Запущенный Ollama
- Загруженная модель, например `qwen2.5-coder:14b`

### Install / Установка

```bash
./scripts/install-macos.sh
```

This installs the CLI package locally and exposes `app`.

Это устанавливает CLI-пакет локально и делает доступной команду `app`.

Optional CLI helper:

```bash
./scripts/install_cli_helper.sh
```

Опциональный CLI helper:

```bash
./scripts/install_cli_helper.sh
```

### Run / Запуск

Start the interactive agent:

```bash
app start /path/to/project
```

Start with a specific model:

```bash
app start /path/to/project --model qwen2.5-coder:14b
```

Start with a specific role:

```bash
app start /path/to/project --role software-architect
```

Запустить интерактивного агента:

```bash
app start /path/to/project
```

Выбрать модель:

```bash
app start /path/to/project --model qwen2.5-coder:14b
```

Выбрать роль:

```bash
app start /path/to/project --role software-architect
```

### Native macOS App / Native macOS app

Build and run the GUI:

```bash
./scripts/build_and_run_macos.sh
```

Manual GUI loop:

```bash
cd macos/LocalCodexMac
swift test
swift build
swift run LocalCodexMac
```

GUI build-and-run:

```bash
./scripts/build_and_run_macos.sh
```

Ручной цикл GUI:

```bash
cd macos/LocalCodexMac
swift test
swift build
swift run LocalCodexMac
```

If the app cannot locate the engine automatically:

```bash
export LOCAL_CODEX_ENGINE_ROOT="/Volumes/Inside 1/ЛОКАЛКА"
```

Если приложение не находит engine автоматически:

```bash
export LOCAL_CODEX_ENGINE_ROOT="/Volumes/Inside 1/ЛОКАЛКА"
```

## Core Commands / Основные команды

### Project memory / Память проекта

```bash
app project init
app project status
app project refresh
app project summary
app memory show project_overview
app memory rebuild
```

### Roles / Роли

```bash
app roles list
app roles show code-reviewer
app roles create infra-consultant
app roles scaffold
app roles use software-architect
app roles current
```

Built-in role profiles now include `frontend-engineer`, `backend-engineer`, `test-engineer`, `performance-optimizer`, `refactoring-strategist`, `release-engineer`, `api-designer`, `migration-engineer`, `qa-analyst`, `bug-hunter`, plus the core roles for architecture, review, debugging, design, and product thinking.

Встроенные профили ролей теперь включают `frontend-engineer`, `backend-engineer`, `test-engineer`, `performance-optimizer`, `refactoring-strategist`, `release-engineer`, `api-designer`, `migration-engineer`, `qa-analyst`, `bug-hunter`, а также базовые роли для архитектуры, ревью, отладки, дизайна и продуктового мышления.

### Tasks / Задачи

```bash
app task create --title "Auth refactor" --request "Переработать вход пользователя"
app task list
app task show task-2026-04-13-auth-refactor
app task use task-2026-04-13-auth-refactor
app task plan task-2026-04-13-auth-refactor
app task note task-2026-04-13-auth-refactor --kind finding --text "Нашел узкое место в валидации."
app task done task-2026-04-13-auth-refactor
app task archive task-2026-04-13-auth-refactor
app task current
```

### Prompt / Промпт

```bash
app prompt inspect --role code-reviewer --task "Review the auth flow"
```

### Patches / Патчи

```bash
app diff
app patch status
app patch apply
app patch reject
```

### Extensions and registry / Расширения и каталог

```bash
app extensions install owner/repo --path packs/roles --yes
app extensions list
app extensions doctor
app registry add-source ./extensions-registry.json
app registry refresh
app registry list
app registry install sample.reviewed
```

## `.local-codex/`

Project memory lives inside `.local-codex/` in the selected repository. It stays fully inspectable and editable on disk.

### Structure

- `project_overview.md` - project summary plus manual notes
- `architecture_notes.md` - architecture observations plus manual notes
- `decisions_log.md` - decision history and manual notes
- `policy.json` - safe execution policy, approval modes, allow/deny rules
- `pending-change.json` - last pending patch or its final status
- `patches/` - patch archives and diff artifacts
- `module_summaries/` - summaries for important source roots and files
- `prompts/` - reusable prompts and role profiles
- `prompts/roles/` - built-in and custom roles in Markdown
- `tasks/` - task index, active work, archive, and templates
- `state.json` - project state: schema version, timestamps, active role, selected model, current task, project root
- `extensions/` - inspectable workspace for GitHub-installed extensions
- `extensions/registry.json` - installed extension catalog and activation state
- `extensions/cache/` - cached manifests and files
- `extensions/installed/` - installed extension files

### Memory workflow

- `app project init` creates the `.local-codex/` structure
- `app project refresh` scans the repo and updates generated summaries
- `app memory rebuild` runs the same regeneration cycle
- `app project status` shows memory state, current role, model, task, and approval mode
- Manual notes stay separated from generated content with explicit markers:
  - `<!-- GENERATED START -->`
  - `<!-- GENERATED END -->`
  - `<!-- MANUAL NOTES START -->`
  - `<!-- MANUAL NOTES END -->`

## GUI

The macOS GUI lives in `macos/LocalCodexMac/` and wraps the same filesystem-based engine used by the CLI.

What the GUI does:

- opens a project folder through the native file picker
- reads the same `.local-codex/` files as the CLI
- shows project, tasks, roles, prompt inspector, patches, policy, session, extensions, and registry views
- runs the existing CLI engine through `node src/cli.js`
- writes the engine root into the app bundle during the macOS build so Finder launches can still resolve the local CLI engine
- does not keep a separate hidden source of truth

Source of truth on disk:

- `.local-codex/state.json`
- `.local-codex/tasks/`
- `.local-codex/prompts/roles/`
- `.local-codex/pending-change.json`
- `.local-codex/patches/`
- `.local-codex/policy.json`

GUI localization:

- `ru` - default language
- `en` - fallback English pack

UI labels, buttons, menus, statuses, and errors go through localization and default to Russian-first UX.

Supported GUI flows:

- choose a project folder
- initialize `.local-codex`
- refresh project status
- inspect tasks and roles
- manage extensions and registry entries
- inspect the composed prompt
- inspect pending patches and apply/reject them
- run the session console on top of the CLI engine
- change language in Settings

## Release

Release preparation scripts live in `scripts/`:

- `scripts/build_macos_app.sh`
- `scripts/run_macos_app.sh`
- `scripts/package_macos_dmg.sh`
- `scripts/sign_macos_app.sh`
- `scripts/notarize_macos_app.sh`
- `scripts/staple_macos_app.sh`
- `scripts/validate_notarized_app.sh`
- `scripts/install_cli_helper.sh`
- `scripts/release_candidate_smoke.sh`

Release docs:

- `CHANGELOG.md`
- `docs/release-checklist.md`
- `docs/gui-smoke-checklist.md`
- `docs/manual-qa-template.md`
- `docs/release-notes-template.md`
- `docs/release-notes-1.0.0.md`

Signing and notarization are intentionally environment-driven. Credentials are expected from environment variables or a local secure setup, not from the repository.

## Notes / Примечания

- Internal identifiers such as `app`, `LocalCodexMac`, and `.local-codex/` remain unchanged for compatibility.
- Public product branding is `Workbench`.
- The first public release target is `1.0.0`.
