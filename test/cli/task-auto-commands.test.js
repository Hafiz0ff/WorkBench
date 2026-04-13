import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createTask } from '../../src/tasks.js';
import { stageProjectPatch } from '../../src/patches.js';
import { writeProvidersConfig } from '../../src/providers/index.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-task-auto-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProvidersConfig(root, {
    default: 'ollama',
    contextWindow: {
      historyMessages: 20,
      summarizeAfter: 50,
    },
    providers: {
      ollama: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        defaultModel: 'qwen2.5-coder:14b',
      },
    },
  });
  return root;
}

test('task auto dry-run shows a plan without creating run state', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto dry run',
    userRequest: 'Проверить auto dry-run',
    summary: 'Проверка команд auto',
  });

  const mockImport = new URL('../../test/support/mock-provider-fetch.mjs', import.meta.url).href;
  const result = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'auto',
    task.id,
    '--request',
    'Добавь JWT auth',
    '--dry-run',
  ], {
    cwd: root,
    env: {
      ...process.env,
      APP_LOCALE: 'ru',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${new URL('../../test/support/mock-provider-fetch.mjs', import.meta.url).href}`,
      MOCK_OLLAMA_CHAT_RESPONSE: `${JSON.stringify({
        message: {
          content: JSON.stringify([
            {
              stepId: 'step-1',
              title: 'Update auth flow',
              description: 'Refactor auth flow',
              files: ['src/auth.js'],
            },
          ]),
        },
        done: true,
      })}\n`,
    },
    maxBuffer: 1024 * 1024,
  });

  assert.match(result.stdout.toString(), /План auto run:/);
  assert.match(result.stdout.toString(), /1 шаг|шагов/);
  await assert.rejects(() => readFile(path.join(task.folderPath, 'auto-run.json'), 'utf8'));
});

test('task run-status, abort, and runs use on-disk auto run state', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto status',
    userRequest: 'Проверить auto status',
    summary: 'Проверка run-status',
  });

  await stageProjectPatch(root, {
    taskId: task.id,
    summary: 'Auto patch',
    changes: [
      {
        path: 'src/rollback.txt',
        action: 'update',
        afterContent: 'new content\n',
      },
    ],
  });

  const run = {
    runId: 'run-20260413-cli01',
    taskId: task.id,
    request: 'Проверить auto status',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    status: 'running',
    startedAt: '2026-04-13T20:00:00.000Z',
    completedAt: null,
    plan: [
      {
        stepId: 'step-1',
        title: 'Update auth flow',
        description: 'Refactor auth flow',
        files: ['src/auth.js'],
        status: 'running',
        patch: 'patch-001.diff',
        testResult: null,
        attempts: 1,
        completedAt: null,
      },
    ],
    summary: null,
    testCommand: 'npm test',
    retryMax: 3,
    sessionId: 'sess-20260413-cli01',
    abortOnTestFail: false,
  };

  await mkdir(path.join(task.folderPath, 'auto-runs'), { recursive: true });
  await writeFile(path.join(task.folderPath, 'auto-runs', `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(path.join(task.folderPath, 'auto-run.json'), `${JSON.stringify(run, null, 2)}\n`);

  const statusResult = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'run-status',
    task.id,
  ], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(statusResult.stdout.toString(), /Auto Run:/);
  assert.match(statusResult.stdout.toString(), /step-1/);

  const runsResult = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'runs',
    task.id,
  ], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(runsResult.stdout.toString(), /Auto Runs задачи:/);
  assert.match(runsResult.stdout.toString(), /run-20260413-cli01/);

  const abortResult = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'abort',
    task.id,
  ], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(abortResult.stdout.toString(), /Auto run прерван|прерван/);

  const updatedRun = JSON.parse(await readFile(path.join(task.folderPath, 'auto-runs', `${run.runId}.json`), 'utf8'));
  assert.equal(updatedRun.status, 'aborted');
});
