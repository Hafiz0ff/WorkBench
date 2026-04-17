import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { emitter } from '../src/events.js';
import { ensureProjectPolicy, readProjectPolicy, writeProjectPolicy } from '../src/policy.js';
import {
  dispatch,
  formatMessage,
  initHooks,
  runShellHook,
  sendTelegram,
  testHook,
  validateHook,
} from '../src/hooks.js';

async function createProjectRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-hooks-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'workbench-hooks-test' }, null, 2));
  await ensureProjectPolicy(root);
  return root;
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

function createShellHookPolicy(command, args = [], enabled = true, conditions = {}) {
  return {
    hooks: {
      enabled: true,
      telegram: { botToken: '', chatId: '' },
      rules: [
        {
          id: 'hook-shell',
          name: 'Shell hook',
          enabled,
          on: ['test.completed'],
          channel: 'shell',
          command,
          args,
          conditions,
        },
      ],
    },
  };
}

test('validateHook and formatMessage handle required fields and template expansion', () => {
  assert.equal(validateHook({ id: 'hook-1', channel: 'telegram', on: ['auto.completed'], message: 'ok' }).ok, true);
  assert.equal(validateHook({ channel: 'telegram', on: ['auto.completed'] }).ok, false);
  assert.equal(
    formatMessage('Task {taskId} by {provider}/{model} in {summary.failed} failed', {
      taskId: 'task-123',
      provider: 'openai',
      model: 'gpt-4o',
      summary: { failed: 2 },
    }),
    'Task task-123 by openai/gpt-4o in 2 failed'
  );
});

test('runShellHook uses spawn arguments without shell injection', async () => {
  const spawned = [];
  const fakeSpawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawned.push({ command, args, options });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  const result = await runShellHook({
    command: 'node',
    args: ['-e', 'process.exit(0)'],
  }, {
    projectRoot: '/tmp/project',
    taskId: 'task-1',
  }, { spawnImpl: fakeSpawn });

  assert.equal(result.ok, true);
  assert.equal(spawned[0].command, 'node');
  assert.deepEqual(spawned[0].args, ['-e', 'process.exit(0)']);
  assert.equal(spawned[0].options.shell, false);
});

test('sendTelegram resolves secrets and posts the expected payload', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-hooks-home-'));
  const previousHome = process.env.WORKBENCH_HOME;
  try {
    process.env.WORKBENCH_HOME = workbenchHome;
    await fs.writeFile(path.join(workbenchHome, 'secrets.json'), JSON.stringify({
      telegram_bot_token: 'telegram-test-token',
    }, null, 2));

    const calls = [];
    const result = await sendTelegram({
      telegram: {
        botToken: '@secret:telegram_bot_token',
        chatId: '42',
      },
      message: 'Привет, {taskId}',
    }, {
      taskId: 'task-abc',
    }, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      retryDelayMs: 0,
    });

    assert.equal(result.ok, true);
    assert.match(calls[0].url, /bottelegram-test-token\/sendMessage$/);
    assert.equal(JSON.parse(calls[0].init.body).text, 'Привет, task-abc');
  } finally {
    if (previousHome === undefined) {
      delete process.env.WORKBENCH_HOME;
    } else {
      process.env.WORKBENCH_HOME = previousHome;
    }
    await fs.rm(workbenchHome, { recursive: true, force: true });
    await cleanup(root);
  }
});

test('dispatch, initHooks and testHook write hook history and prune to 500 entries', async () => {
  const root = await createProjectRoot();
  const previousHome = process.env.WORKBENCH_HOME;
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-hooks-home-'));
  try {
    process.env.WORKBENCH_HOME = workbenchHome;
    await writeProjectPolicy(root, createShellHookPolicy(process.execPath, ['-e', 'process.exit(0)'], true, { status: 'failed' }));

    const historyPath = path.join(root, '.local-codex', 'hook-history.jsonl');
    const seeded = Array.from({ length: 500 }, (_, index) => JSON.stringify({
      ts: new Date(Date.now() - (index + 1) * 1000).toISOString(),
      hookId: `seed-${index}`,
      event: 'test.completed',
      channel: 'shell',
      status: 'sent',
      durationMs: 1,
    })).join('\n');
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(historyPath, `${seeded}\n`, 'utf8');

    const skipped = await dispatch({
      type: 'test.completed',
      status: 'passed',
      projectRoot: root,
    });
    assert.equal(skipped.length, 0);

    const matched = await dispatch({
      type: 'test.completed',
      status: 'failed',
      projectRoot: root,
    });
    assert.equal(matched.length, 1);
    assert.equal(matched[0].hookId, 'hook-shell');

    const afterDispatch = await fs.readFile(historyPath, 'utf8');
    assert.equal(afterDispatch.trim().split(/\r?\n/).length, 500);

    await initHooks(root);
    emitter.emit('workbench:event', {
      type: 'test.completed',
      status: 'failed',
      projectRoot: root,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const historyAfterEmitter = await fs.readFile(historyPath, 'utf8');
    assert.equal(historyAfterEmitter.trim().split(/\r?\n/).length, 500);

    const testResults = await testHook(root, 'hook-shell');
    assert.equal(testResults.length, 1);
    assert.equal(testResults[0].status, 'sent');
  } finally {
    if (previousHome === undefined) {
      delete process.env.WORKBENCH_HOME;
    } else {
      process.env.WORKBENCH_HOME = previousHome;
    }
    await fs.rm(workbenchHome, { recursive: true, force: true });
    await cleanup(root);
  }
});
