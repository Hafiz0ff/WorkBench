import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createTask } from '../src/tasks.js';
import { stageProjectFileChange, applyPatchArtifact } from '../src/patches.js';
import { runTests } from '../src/test-runner.js';
import { scaffoldBuiltInRoles, setActiveRole } from '../src/roles.js';
import { getDefaultPolicy, writeProjectPolicy } from '../src/policy.js';
import {
  formatStatsReport,
  getStatsFilePath,
  pruneEvents,
  readStats,
  refreshStats,
  topFiles,
  trackEvent,
} from '../src/stats.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-stats-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProjectPolicy(root, getDefaultPolicy());
  return root;
}

test('trackEvent respects disabled stats config', async () => {
  const root = await createTempProject();
  await writeProjectPolicy(root, {
    ...getDefaultPolicy(),
    stats: {
      ...getDefaultPolicy().stats,
      enabled: false,
    },
  });

  await trackEvent(root, { type: 'role.used', role: 'backend-engineer' });
  await assert.rejects(() => readFile(path.join(root, '.local-codex', 'events.jsonl'), 'utf8'));
  assert.equal(await readStats(root), null);
});

test('refreshStats aggregates tasks, patches, tests, providers and roles', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Stats flow',
    userRequest: 'Проверить аналитику',
    relevantFiles: ['src/index.js'],
    summary: 'Stats aggregation task',
  }, 'ru');
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await stageProjectFileChange(root, 'src/index.js', 'export const value = 2;\n', {
    policy: {
      ...getDefaultPolicy(),
      approvalMode: 'auto-safe',
    },
  });
  await applyPatchArtifact(root, null, {
    policy: {
      ...getDefaultPolicy(),
      approvalMode: 'auto-safe',
    },
    skipTests: true,
  });
  await runTests({
    projectRoot: root,
    command: 'node -e "console.log(\'1 passed, 0 failed\')"',
    allowApprovalBypass: true,
  });
  await scaffoldBuiltInRoles(root);
  await setActiveRole(root, 'backend-engineer');
  await trackEvent(root, {
    type: 'provider.request',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 1200,
    completionTokens: 300,
  });

  const stats = await refreshStats(root);
  assert.equal(stats.tasks.total, 1);
  assert.ok(stats.patches.total >= 1);
  assert.ok(stats.tests.total >= 1);
  assert.equal(stats.providers.topProvider, 'openai');
  assert.equal(stats.roles.topRole, 'backend-engineer');
  assert.equal(stats.tokens.totalPrompt, 1200);
  assert.equal(stats.tokens.totalCompletion, 300);
  assert.match(formatStatsReport(stats, { section: 'tasks' }), /ЗАДАЧИ/);
  assert.match(JSON.stringify(topFiles(stats, 1)), /src\/index\.js/);
  assert.ok(await readStats(root));
  assert.ok(await readFile(getStatsFilePath(root), 'utf8'));
  assert.ok(task.id);
});

test('pruneEvents removes stale analytics entries', async () => {
  const root = await createTempProject();
  await writeFile(path.join(root, '.local-codex', 'events.jsonl'), [
    JSON.stringify({ ts: '2020-01-01T00:00:00.000Z', type: 'task.created', taskId: 'old-task' }),
    JSON.stringify({ ts: new Date().toISOString(), type: 'task.created', taskId: 'new-task' }),
  ].join('\n').concat('\n'));

  const result = await pruneEvents(root, 30);
  assert.equal(result.removed, 1);
  const remaining = await readFile(path.join(root, '.local-codex', 'events.jsonl'), 'utf8');
  assert.match(remaining, /new-task/);
  assert.doesNotMatch(remaining, /old-task/);
});
