import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { trackUsage } from '../../src/budget.js';
import { getDefaultPolicy, writeProjectPolicy } from '../../src/policy.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-budget-cli-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProjectPolicy(root, getDefaultPolicy());
  return root;
}

test('app budget commands report, export and update policy data', async () => {
  const root = await createTempProject();
  await trackUsage(root, {
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 1240,
    completionTokens: 380,
    taskId: 'task-abc',
    sessionId: 'sess-001',
  });
  await trackUsage(root, {
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    promptTokens: 890,
    completionTokens: 210,
    taskId: 'task-abc',
    sessionId: 'sess-001',
  });

  const report = await execFileAsync(process.execPath, [CLI_PATH, 'budget'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(report.stdout.toString(), /Token Budget/);
  assert.match(report.stdout.toString(), /openai/);

  const provider = await execFileAsync(process.execPath, [CLI_PATH, 'budget', '--provider', 'openai'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(provider.stdout.toString(), /openai — детальная статистика/);
  assert.match(provider.stdout.toString(), /gpt-4o/);

  const history = await execFileAsync(process.execPath, [CLI_PATH, 'budget', 'history', '--days', '7'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(history.stdout.toString(), /Token Budget — history/);
  assert.match(history.stdout.toString(), /2026-04-14/);
  assert.match(history.stdout.toString(), /2\.7K/);

  const setResult = await execFileAsync(process.execPath, [CLI_PATH, 'budget', 'set', 'openai', '--daily', '500000', '--monthly', '8000000'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(setResult.stdout.toString(), /Лимиты openai обновлены/);
  const policy = JSON.parse(await readFile(path.join(root, '.local-codex', 'policy.json'), 'utf8'));
  assert.equal(policy.budget.limits.openai.daily, 500000);
  assert.equal(policy.budget.limits.openai.monthly, 8000000);

  const exportDir = path.join(root, 'exports');
  await mkdir(exportDir, { recursive: true });
  const exportResult = await execFileAsync(process.execPath, [CLI_PATH, 'budget', 'export', '--format', 'csv', '--output', exportDir], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(exportResult.stdout.toString(), /Бюджет экспортирован/);
  const csv = await readFile(path.join(exportDir, 'workbench-budget.csv'), 'utf8');
  assert.match(csv, /ts,provider,model,promptTokens,completionTokens,totalTokens,costUsd,taskId,sessionId/);
});

test('app budget prune removes stale usage rows', async () => {
  const root = await createTempProject();
  await mkdir(path.join(root, '.local-codex'), { recursive: true });
  await writeFile(path.join(root, '.local-codex', 'token-usage.jsonl'), [
    JSON.stringify({ ts: '2020-01-01T00:00:00.000Z', provider: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
    JSON.stringify({ ts: new Date().toISOString(), provider: 'openai', model: 'gpt-4o', promptTokens: 12, completionTokens: 3, totalTokens: 15 }),
  ].join('\n').concat('\n'));

  const prune = await execFileAsync(process.execPath, [CLI_PATH, 'budget', 'prune', '--keep-days', '30'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(prune.stdout.toString(), /Удалено записей: 1/);
  const remaining = await readFile(path.join(root, '.local-codex', 'token-usage.jsonl'), 'utf8');
  assert.doesNotMatch(remaining, /2020-01-01/);
});
