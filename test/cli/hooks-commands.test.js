import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ensureProjectPolicy, readProjectPolicy, writeProjectPolicy } from '../../src/policy.js';

const CLI = path.join(process.cwd(), 'src', 'cli.js');

async function createProjectRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-hooks-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'workbench-cli-hooks-test' }, null, 2));
  await ensureProjectPolicy(root);
  return root;
}

test('hooks CLI commands list, history and enable/disable work', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-hooks-home-'));
  try {
    const historyPath = path.join(root, '.local-codex', 'hook-history.jsonl');
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(historyPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      hookId: 'hook-seed',
      event: 'test.completed',
      channel: 'telegram',
      status: 'sent',
      durationMs: 12,
    })}\n`, 'utf8');

    const list = spawnSync(process.execPath, [CLI, 'hooks', 'list'], {
      cwd: root,
      env: {
        ...process.env,
        WORKBENCH_HOME: workbenchHome,
      },
      encoding: 'utf8',
    });
    assert.equal(list.status, 0);
    assert.match(list.stdout, /Хуки/u);
    assert.match(list.stdout, /hook-auto-done/u);

    const history = spawnSync(process.execPath, [CLI, 'hooks', 'history', '--limit', '1'], {
      cwd: root,
      env: {
        ...process.env,
        WORKBENCH_HOME: workbenchHome,
      },
      encoding: 'utf8',
    });
    assert.equal(history.status, 0);
    assert.match(history.stdout, /hook-seed/u);

    const enable = spawnSync(process.execPath, [CLI, 'hooks', 'enable', 'hook-custom-shell'], {
      cwd: root,
      env: {
        ...process.env,
        WORKBENCH_HOME: workbenchHome,
      },
      encoding: 'utf8',
    });
    assert.equal(enable.status, 0);
    assert.match(enable.stdout, /включён/u);

    const policy = await readProjectPolicy(root);
    const shellRule = policy.hooks.rules.find((rule) => rule.id === 'hook-custom-shell');
    assert.equal(shellRule.enabled, true);

    const disable = spawnSync(process.execPath, [CLI, 'hooks', 'disable', 'hook-custom-shell'], {
      cwd: root,
      env: {
        ...process.env,
        WORKBENCH_HOME: workbenchHome,
      },
      encoding: 'utf8',
    });
    assert.equal(disable.status, 0);
    assert.match(disable.stdout, /выключен/u);

    const updatedPolicy = await readProjectPolicy(root);
    assert.equal(updatedPolicy.hooks.rules.find((rule) => rule.id === 'hook-custom-shell').enabled, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workbenchHome, { recursive: true, force: true });
  }
});

test('hooks CLI test works against a disabled shell hook', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-hooks-home-'));
  try {
    const policy = await readProjectPolicy(root);
    policy.hooks.rules = [
      {
        id: 'hook-test-shell',
        name: 'Test shell hook',
        enabled: false,
        on: ['test.completed'],
        channel: 'shell',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        conditions: {},
      },
    ];
    await writeProjectPolicy(root, policy);

    const testResult = spawnSync(process.execPath, [CLI, 'hooks', 'test', 'hook-test-shell'], {
      cwd: root,
      env: {
        ...process.env,
        WORKBENCH_HOME: workbenchHome,
      },
      encoding: 'utf8',
    });
    assert.equal(testResult.status, 0);
    assert.match(testResult.stdout, /Отправляю тестовое событие/u);
    assert.match(testResult.stdout, /✅ shell/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workbenchHome, { recursive: true, force: true });
  }
});
