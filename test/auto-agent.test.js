import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { appendMessage } from '../src/conversation.js';
import { createTask } from '../src/tasks.js';
import { abortRun, executeStep, planPhase, runAuto } from '../src/auto-agent.js';
import { stageProjectPatch } from '../src/patches.js';
import { readProjectPolicy } from '../src/policy.js';
import { setProjectFreezeMode } from '../src/freeze-mode.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-auto-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  return root;
}

function createSequencedProvider(responses) {
  let index = 0;
  return {
    name: 'ollama',
    defaultModel: 'mock-model',
    async *chat() {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      yield response;
    },
  };
}

test('auto plan retries invalid JSON and returns normalized steps', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto plan flow',
    userRequest: 'Проверить генерацию плана',
  });
  const provider = createSequencedProvider([
    'not-json',
    JSON.stringify([
      {
        stepId: 'step-1',
        title: 'Create file',
        description: 'Create a file for the feature',
        files: ['src/generated.txt'],
      },
    ]),
  ]);

  const steps = await planPhase(task.id, 'Добавь новый файл', {
    projectRoot: root,
    provider,
    model: 'mock-model',
    retryMax: 2,
    maxSteps: 5,
    memorySummary: 'memory',
    taskContext: 'task context',
    conversationSummary: 'conversation summary',
    allowedShellCommands: [],
    locale: 'ru',
  });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].stepId, 'step-1');
  assert.equal(steps[0].title, 'Create file');
});

test('auto execute step applies patch to disk', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto execute flow',
    userRequest: 'Проверить применение патча',
  });
  const provider = createSequencedProvider([
    JSON.stringify({
      summary: 'Create generated file',
      changes: [
        {
          path: 'src/generated.txt',
          action: 'create',
          content: 'hello from auto mode',
        },
      ],
      validationCommands: [],
    }),
  ]);

  const result = await executeStep(task.id, {
    stepId: 'step-1',
    title: 'Create generated file',
    description: 'Create a file on disk',
    files: ['src/generated.txt'],
  }, {
    projectRoot: root,
    provider,
    model: 'mock-model',
    request: 'Create generated file',
    taskFolderPath: task.folderPath,
    noTests: true,
    locale: 'ru',
  });

  assert.equal(result.status, 'completed');
  assert.ok(result.patchId);
  assert.equal(await readFile(path.join(root, 'src/generated.txt'), 'utf8'), 'hello from auto mode');
});

test('auto execute step audits only in freeze mode', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto freeze audit flow',
    userRequest: 'Проверить аудит в freeze mode',
  });
  const freezeResult = await setProjectFreezeMode(root, true, { reason: 'release candidate' });
  const provider = createSequencedProvider([
    JSON.stringify({
      summary: 'Audit risky control flow',
      findings: [
        {
          severity: 'high',
          message: 'Potential null dereference before validation.',
          file: 'src/generated.txt',
        },
      ],
      validationCommands: [],
    }),
  ]);
  const policy = await readProjectPolicy(root);

  const result = await executeStep(task.id, {
    stepId: 'step-1',
    title: 'Audit generated file',
    description: 'Inspect the code path for logical defects',
    files: ['src/generated.txt'],
  }, {
    projectRoot: root,
    provider,
    model: 'mock-model',
    request: 'Audit generated file',
    taskFolderPath: task.folderPath,
    noTests: true,
    locale: 'ru',
    policy: freezeResult.policy || policy,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.auditMode, true);
  assert.equal(result.patchId, null);
  assert.equal(result.findings.length, 1);
  await assert.rejects(() => readFile(path.join(root, 'src', 'generated.txt'), 'utf8'));
});

test('auto run emits lifecycle events', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto lifecycle flow',
    userRequest: 'Проверить auto lifecycle',
  });
  const provider = createSequencedProvider([
    JSON.stringify([
      {
        stepId: 'step-1',
        title: 'Create file',
        description: 'Create a file for the feature',
        files: ['src/lifecycle.txt'],
      },
    ]),
    JSON.stringify({
      summary: 'Create lifecycle file',
      changes: [
        {
          path: 'src/lifecycle.txt',
          action: 'create',
          content: 'auto lifecycle',
        },
      ],
      validationCommands: [],
    }),
    '# Auto run summary\n- Done',
  ]);

  const result = await runAuto(task.id, 'Проверить lifecycle', {
    projectRoot: root,
    provider,
    model: 'mock-model',
    autoMode: {
      enabled: true,
      requirePlanApproval: false,
      testOnEachStep: false,
      retryMax: 1,
      maxSteps: 5,
      summarizeAfter: 50,
      historyMessages: 20,
    },
    noTests: true,
    locale: 'ru',
  });

  assert.equal(result.run.status, 'completed');
  await new Promise((resolve) => setTimeout(resolve, 25));
  const events = await readFile(path.join(root, '.local-codex', 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"auto\.started"/);
  assert.match(events, /"type":"auto\.step"/);
  assert.match(events, /"type":"auto\.completed"/);
});

test('auto dry-run returns a plan without mutating workspace state', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto dry run',
    userRequest: 'Проверить dry run',
  });
  const provider = createSequencedProvider([
    JSON.stringify([
      {
        stepId: 'step-1',
        title: 'Review files',
        description: 'Inspect the project structure',
        files: ['src/index.js'],
      },
    ]),
  ]);

  const result = await runAuto(task.id, 'Проверить dry-run', {
    projectRoot: root,
    provider,
    model: 'mock-model',
    autoMode: {
      enabled: true,
      requirePlanApproval: false,
      testOnEachStep: false,
      retryMax: 1,
      maxSteps: 5,
      summarizeAfter: 50,
      historyMessages: 20,
    },
    dryRun: true,
    locale: 'ru',
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.plan.length, 1);
  await assert.rejects(() => readFile(path.join(task.folderPath, 'auto-run.json'), 'utf8'));
});

test('auto abort rolls back a pending patch and marks the run aborted', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auto abort flow',
    userRequest: 'Проверить abort',
  });
  const targetFile = path.join(root, 'src', 'rollback.txt');
  await writeFile(targetFile, 'old content\n');

  const staged = await stageProjectPatch(root, {
    taskId: task.id,
    role: 'senior-engineer',
    model: 'mock-model',
    summary: 'Update rollback file',
    changes: [
      {
        path: 'src/rollback.txt',
        action: 'update',
        afterContent: 'new content\n',
      },
    ],
    validationCommands: [],
  });

  await writeFile(targetFile, 'new content\n');
  const run = {
    runId: 'run-20260413-abort01',
    taskId: task.id,
    request: 'Проверить abort',
    provider: 'ollama',
    model: 'mock-model',
    status: 'running',
    startedAt: '2026-04-13T20:00:00.000Z',
    completedAt: null,
    plan: [
      {
        stepId: 'step-1',
        title: 'Rollback file',
        description: 'Simulate a pending auto step',
        files: ['src/rollback.txt'],
        status: 'running',
        patchId: staged.pending.patchId,
        attempts: 1,
      },
    ],
    summary: null,
    testCommand: null,
    retryMax: 3,
    sessionId: 'sess-20260413-abort01',
    testOnEachStep: false,
    abortOnTestFail: false,
  };
  await mkdir(path.join(task.folderPath, 'auto-runs'), { recursive: true });
  await writeFile(path.join(task.folderPath, 'auto-runs', `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(path.join(task.folderPath, 'auto-run.json'), `${JSON.stringify(run, null, 2)}\n`);
  await appendMessage(task.folderPath, {
    role: 'system',
    content: 'Auto run started for abort test.',
    provider: 'ollama',
    model: 'mock-model',
    sessionId: run.sessionId,
  });

  const result = await abortRun(task.id, run.runId, { projectRoot: root });

  assert.equal(result.aborted, true);
  assert.equal(await readFile(targetFile, 'utf8'), 'old content\n');
  assert.equal(result.run.status, 'aborted');
  await new Promise((resolve) => setTimeout(resolve, 25));
  const events = await readFile(path.join(root, '.local-codex', 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"auto\.aborted"/);
});
