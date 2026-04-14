#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('./cli.js', import.meta.url));
const TOP_LEVEL_COMMANDS = new Set([
  'help',
  'models',
  'roles',
  'project',
  'memory',
  'prompt',
  'task',
  'diff',
  'patch',
  'ext',
  'extensions',
  'registry',
  'tree',
  'start',
  'workspace',
]);
const WORKSPACE_COMMANDS = new Set([
  'add',
  'list',
  'switch',
  'status',
  'remove',
  'rename',
  'pin',
  'unpin',
  'tag',
  'untag',
  'search',
  'refresh',
  'config',
  'repair',
]);

function isOptionLike(value) {
  return typeof value === 'string' && value.startsWith('-');
}

export function resolveWorkbenchInvocation(argv, cwd = process.cwd()) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  if (!args.length) {
    return ['workspace', 'switch'];
  }

  const [first, ...rest] = args;
  if (!first || first.startsWith('-') || TOP_LEVEL_COMMANDS.has(first)) {
    return args;
  }
  if (WORKSPACE_COMMANDS.has(first)) {
    return ['workspace', first, ...rest];
  }
  if (rest.length > 0 && rest.every((value) => !isOptionLike(value))) {
    return ['start', first, '--task', rest.join(' ')];
  }
  return ['start', first, ...rest];
}

function main() {
  const args = resolveWorkbenchInvocation(process.argv.slice(2));
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

const executedDirectly = fileURLToPath(import.meta.url) === process.argv[1];

if (executedDirectly) {
  main();
}
