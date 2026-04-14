# WorkBench 1.4.0 Release Notes

## Highlights

- Event hooks for Telegram, shell scripts, and webhooks.
- Shared emitter for internal WorkBench events.
- Hooks dashboard section and CLI management commands.

## Security

- Shell hooks use `spawn()` only.
- Telegram tokens are stored in `~/.workbench/secrets.json`.

## Notes

- The release stays compatible with the existing stats, auto-mode, CI loop, and workspace flows.
