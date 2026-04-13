import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureProjectMemory } from '../../src/memory.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject(home, name) {
  const root = path.join(home, 'projects', name);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name,
    type: 'module',
  }, null, 2));
  await ensureProjectMemory(root);
  return root;
}

test('workspace CLI commands add, list, search, refresh, config, and remove work', async () => {
  const previousHome = process.env.WORKBENCH_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-workspace-'));
  process.env.WORKBENCH_HOME = home;
  try {
    const root = await createTempProject(home, 'tasuj');

    const addResult = await execFileAsync(process.execPath, [
      CLI_PATH,
      'workspace',
      'add',
      root,
      '--alias',
      'tasuj',
      '--tag',
      'trading',
      '--pin',
    ], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(addResult.stdout.toString(), /Добавлен workspace: tasuj/);

    const listResult = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'list'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(listResult.stdout.toString(), /Воркспейсы \(1\)/);
    assert.match(listResult.stdout.toString(), /tasuj/);

    const searchResult = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'search', 'trading'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(searchResult.stdout.toString(), /Поиск: trading/);
    assert.match(searchResult.stdout.toString(), /tasuj/);

    const statusResult = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'status', 'tasuj'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(statusResult.stdout.toString(), /Воркспейс: tasuj/);
    assert.match(statusResult.stdout.toString(), /Путь:/);

    const refreshResult = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'refresh', 'tasuj'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(refreshResult.stdout.toString(), /Snapshot обновлён: tasuj/);

    const configResult = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'config'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(configResult.stdout.toString(), /defaultProvider:/);

    const setConfigResult = await execFileAsync(process.execPath, [
      CLI_PATH,
      'workspace',
      'config',
      '--set',
      'autoRefreshOnSwitch=false',
    ], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(setConfigResult.stdout.toString(), /Глобальный конфиг обновлён/);

    const configFile = JSON.parse(await fs.readFile(path.join(home, 'config.json'), 'utf8'));
    assert.equal(configFile.autoRefreshOnSwitch, false);

    const removeResult = await execFileAsync(process.execPath, [
      CLI_PATH,
      'workspace',
      'remove',
      'tasuj',
      '--confirm',
    ], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(removeResult.stdout.toString(), /Удалён из реестра: tasuj/);

    const listAfterRemove = await execFileAsync(process.execPath, [CLI_PATH, 'workspace', 'list'], {
      cwd: root,
      env: { ...process.env, APP_LOCALE: 'ru' },
      maxBuffer: 1024 * 1024,
    });
    assert.match(listAfterRemove.stdout.toString(), /Реестр пуст\./);
  } finally {
    process.env.WORKBENCH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});
