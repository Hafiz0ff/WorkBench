# ТЗ: WorkBench — Фаза 7
## Event Hooks / Telegram уведомления

**Версия:** 1.0.0  
**Дата:** 2026-04-14  
**Статус:** В работе  
**Документация:** Все артефакты этой фазы сохранять в `.local-codex/docs/phase-7/`

---

## 0. Политика документирования

Следовать той же схеме, что установлена в предыдущих фазах.

**Правила:** после каждого шага кодекс дописывает прогресс в `architecture.md`, после завершения фазы пишет `summary.md`, `index.md` обновляется на старте и завершении.

---

## 1. Цель

Добавить систему event hooks для shell-скриптов, HTTP/webhook и Telegram уведомлений на внутренние события WorkBench.

---

## 2. Контекст

- `src/stats.js` уже записывает события в `.local-codex/events.jsonl`
- `src/server.js` уже раздаёт SSE
- Не хватает активной реакции на события

---

## 3. Архитектура

- `src/events.js` — shared EventEmitter
- `src/hooks.js` — dispatch engine
- `policy.json` — hooks config and secrets indirection via `@secret:key`
- `~/.workbench/secrets.json` — local Telegram token store

---

## 4. Критерии приёмки

- `app hooks setup telegram` сохраняет токен в secrets-файл
- `app hooks test <id>` доставляет тестовое сообщение
- Shell hooks используют `spawn()`, не `exec()`
- `hook-history.jsonl` и `hook-errors.log` не попадают в репозиторий

