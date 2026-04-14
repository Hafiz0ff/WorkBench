import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTask } from '../../src/tasks.js';
import { scaffoldBuiltInRoles, setActiveRole } from '../../src/roles.js';
import { runTests } from '../../src/test-runner.js';
import { trackEvent } from '../../src/stats.js';
import { getDefaultPolicy, writeProjectPolicy } from '../../src/policy.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-cli-stats-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProjectPolicy(root, getDefaultPolicy());
  return root;
}

test('app stats commands report, export and refresh analytics', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Stats CLI',
    userRequest: 'Проверить CLI статистики',
    relevantFiles: ['src/index.js'],
  }, 'ru');
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await scaffoldBuiltInRoles(root);
  await setActiveRole(root, 'backend-engineer');
  await runTests({
    projectRoot: root,
    command: 'node -e "console.log(\'1 passed, 0 failed\')"',
    allowApprovalBypass: true,
  });
  await trackEvent(root, {
    type: 'provider.request',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 1000,
    completionTokens: 250,
  });

  const report = await execFileAsync(process.execPath, [CLI_PATH, 'stats'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(report.stdout.toString(), /WorkBench — статистика проекта/);
  assert.match(report.stdout.toString(), /ЗАДАЧИ/);

  const section = await execFileAsync(process.execPath, [CLI_PATH, 'stats', '--section', 'patches'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(section.stdout.toString(), /ПАТЧИ/);

  const json = await execFileAsync(process.execPath, [CLI_PATH, 'stats', '--json'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(json.stdout.toString());
  assert.equal(parsed.tasks.total, 1);
  assert.equal(parsed.providers.topProvider, 'openai');

  const refresh = await execFileAsync(process.execPath, [CLI_PATH, 'stats', 'refresh'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(refresh.stdout.toString(), /Статистика обновлена/);

  const prune = await execFileAsync(process.execPath, [CLI_PATH, 'stats', 'prune', '--keep-days', '30'], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(prune.stdout.toString(), /Удалено событий:/);

  const exportDir = path.join(root, 'exports');
  await mkdir(exportDir, { recursive: true });
  const exported = await execFileAsync(process.execPath, [CLI_PATH, 'stats', 'export', '--format', 'csv', '--output', exportDir], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(exported.stdout.toString(), /Статистика экспортирована/);
  const csv = await readFile(path.join(exportDir, 'workbench-stats.csv'), 'utf8');
  assert.match(csv, /section,metric,value/);

  await writeFile(path.join(root, '.local-codex', 'events.jsonl'), [
    JSON.stringify({ ts: '2020-01-01T00:00:00.000Z', type: 'task.created', taskId: 'old-task' }),
    JSON.stringify({ ts: new Date().toISOString(), type: 'task.created', taskId: task.id }),
  ].join('\n').concat('\n'));
});
