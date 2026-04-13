import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeProjectPolicy, getDefaultPolicy } from '../../src/policy.js';
import { ensureProvidersWorkspace } from '../../src/providers/index.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-cli-test-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
    scripts: {
      test: 'node -e "console.log(\'1 passed, 0 failed\')"',
    },
  }, null, 2));
  await ensureProvidersWorkspace(root);
  await writeProjectPolicy(root, {
    ...getDefaultPolicy(),
    testRunner: {
      command: 'node -e "console.log(\'1 passed, 0 failed\')"',
      timeout: 5000,
      autoRun: {
        onPatchApply: true,
        onAutoStep: true,
      },
      onFail: {
        action: 'warn',
        rollbackPatches: true,
      },
      history: {
        keepLast: 20,
      },
      runners: [],
      env: {},
    },
  });
  return root;
}

test('app test run/history/show/detect/config work end to end', async () => {
  const root = await createTempProject();

  const runResult = await execFileAsync(process.execPath, [CLI_PATH, 'test', 'run'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(runResult.stdout.toString(), /Прогон тестов:/);
  assert.match(runResult.stdout.toString(), /успешно|passed/i);

  const historyResult = await execFileAsync(process.execPath, [CLI_PATH, 'test', 'history'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(historyResult.stdout.toString(), /История тестов/);
  assert.match(historyResult.stdout.toString(), /testrun-/);

  const historyLines = (await readFile(path.join(root, '.local-codex', 'test-runs.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean);
  const history = JSON.parse(historyLines[0]);
  const showResult = await execFileAsync(process.execPath, [CLI_PATH, 'test', 'show', history.runId], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(showResult.stdout.toString(), /Вывод теста|Прогон тестов/);
  assert.match(showResult.stdout.toString(), /1 passed|1\/1/);

  const detectResult = await execFileAsync(process.execPath, [CLI_PATH, 'test', 'detect', '--yes'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(detectResult.stdout.toString(), /Авто-определение тест-раннера/);
  assert.match(detectResult.stdout.toString(), /Тест-раннер сохранён/);

  const configResult = await execFileAsync(process.execPath, [CLI_PATH, 'test', 'config'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(configResult.stdout.toString(), /Конфигурация тест-раннера/);
  assert.match(configResult.stdout.toString(), /node -e/);
});
