import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  checkLimit,
  exportCSV,
  formatReport,
  formatTokens,
  getCache,
  getTokenUsageFilePath,
  pruneUsage,
  refreshCache,
  trackUsage,
  listUsageEntries,
} from '../src/budget.js';
import { getDefaultPolicy, writeProjectPolicy } from '../src/policy.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-budget-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProjectPolicy(root, getDefaultPolicy());
  return root;
}

async function writeUsageLog(root, entries) {
  await mkdir(path.join(root, '.local-codex'), { recursive: true });
  await writeFile(getTokenUsageFilePath(root), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

test('trackUsage writes token usage rows and respects disabled budget config', async () => {
  const root = await createTempProject();

  const recorded = await trackUsage(root, {
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 10,
    completionTokens: 5,
    taskId: 'task-1',
    sessionId: 'sess-1',
  });

  assert.equal(recorded.provider, 'openai');
  const lines = await readFile(getTokenUsageFilePath(root), 'utf8');
  const [entry] = lines.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(entry.provider, 'openai');
  assert.equal(entry.totalTokens, 15);
  assert.ok(entry.costUsd > 0);

  const disabledRoot = await createTempProject();
  await writeProjectPolicy(disabledRoot, {
    ...getDefaultPolicy(),
    budget: {
      ...getDefaultPolicy().budget,
      enabled: false,
    },
  });
  const disabledResult = await trackUsage(disabledRoot, {
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 10,
    completionTokens: 5,
  });
  assert.equal(disabledResult, null);
  await assert.rejects(() => readFile(getTokenUsageFilePath(disabledRoot), 'utf8'));
});

test('refreshCache aggregates periods and provider breakdowns', async () => {
  const root = await createTempProject();
  const now = new Date('2026-04-14T20:00:00.000Z').getTime();
  const entries = [
    { ts: new Date(now).toISOString(), provider: 'openai', model: 'gpt-4o', promptTokens: 100, completionTokens: 25, totalTokens: 125 },
    { ts: new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString(), provider: 'openai', model: 'gpt-4o', promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    { ts: new Date(now - (10 * 24 * 60 * 60 * 1000)).toISOString(), provider: 'ollama', model: 'qwen2.5-coder:14b', promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    { ts: new Date(now - (40 * 24 * 60 * 60 * 1000)).toISOString(), provider: 'gemini', model: 'gemini-2.5-flash', promptTokens: 200, completionTokens: 20, totalTokens: 220 },
  ];
  await writeUsageLog(root, entries);

  const cache = await refreshCache(root);
  assert.equal(cache.byProvider.openai.today.total, 125);
  assert.equal(cache.byProvider.openai.week.total, 185);
  assert.equal(cache.byProvider.openai.month.total, 185);
  assert.equal(cache.byProvider.ollama.month.total, 25);
  assert.equal(cache.total.today.total, 125);
  assert.equal(cache.total.week.total, 185);
  assert.equal(cache.total.month.total, 210);
  assert.ok(Array.isArray(cache.hourly));
  assert.equal(cache.hourly.length, 48);
  assert.ok(Array.isArray(cache.daily));
  assert.equal(cache.daily.length, 90);

  const openaiEntries = await listUsageEntries(root, { provider: 'openai' });
  const report = formatReport(cache, getDefaultPolicy().budget.limits, {
    provider: 'openai',
    entries: openaiEntries,
  });
  assert.match(report, /openai — детальная статистика/);
  assert.match(report, /gpt-4o/);
});

test('checkLimit warns, blocks and respects unlimited providers', async () => {
  const warningRoot = await createTempProject();
  await writeProjectPolicy(warningRoot, {
    ...getDefaultPolicy(),
    budget: {
      ...getDefaultPolicy().budget,
      limits: {
        ...getDefaultPolicy().budget.limits,
        openai: { daily: 100, weekly: 500, monthly: 1000 },
      },
    },
  });
  await writeUsageLog(warningRoot, [
    { ts: new Date().toISOString(), provider: 'openai', model: 'gpt-4o', promptTokens: 80, completionTokens: 10, totalTokens: 90 },
  ]);
  const warningCheck = await checkLimit(warningRoot, 'openai');
  assert.equal(warningCheck.ok, true);
  assert.ok(warningCheck.warnings.length >= 1);
  assert.equal(warningCheck.exceeded.length, 0);

  const blockRoot = await createTempProject();
  await writeProjectPolicy(blockRoot, {
    ...getDefaultPolicy(),
    budget: {
      ...getDefaultPolicy().budget,
      limits: {
        ...getDefaultPolicy().budget.limits,
        openai: { daily: 100, weekly: 500, monthly: 1000 },
      },
    },
  });
  await writeUsageLog(blockRoot, [
    { ts: new Date().toISOString(), provider: 'openai', model: 'gpt-4o', promptTokens: 90, completionTokens: 20, totalTokens: 110 },
  ]);
  const blockCheck = await checkLimit(blockRoot, 'openai');
  assert.equal(blockCheck.ok, false);
  assert.ok(blockCheck.exceeded.length >= 1);

  const unlimitedRoot = await createTempProject();
  await writeProjectPolicy(unlimitedRoot, {
    ...getDefaultPolicy(),
    budget: {
      ...getDefaultPolicy().budget,
      limits: {
        ...getDefaultPolicy().budget.limits,
        total: { daily: null, weekly: null, monthly: null },
        ollama: { daily: null, weekly: null, monthly: null },
      },
    },
  });
  await writeUsageLog(unlimitedRoot, [
    { ts: new Date().toISOString(), provider: 'ollama', model: 'qwen2.5-coder:14b', promptTokens: 400, completionTokens: 100, totalTokens: 500 },
  ]);
  const unlimitedCheck = await checkLimit(unlimitedRoot, 'ollama');
  assert.equal(unlimitedCheck.ok, true);
  assert.equal(unlimitedCheck.warnings.length, 0);
  assert.equal(unlimitedCheck.exceeded.length, 0);
});

test('formatTokens, exportCSV and pruneUsage behave as expected', async () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1K');
  assert.equal(formatTokens(62500), '62.5K');
  assert.equal(formatTokens(1620000), '1.62M');
  assert.equal(formatTokens(null), '—');

  const root = await createTempProject();
  const oldTs = '2020-01-01T00:00:00.000Z';
  const recentTs = new Date().toISOString();
  await writeUsageLog(root, [
    { ts: oldTs, provider: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 5, totalTokens: 15, taskId: 'old', sessionId: 'sess-old' },
    { ts: recentTs, provider: 'ollama', model: 'qwen2.5-coder:14b', promptTokens: 20, completionTokens: 8, totalTokens: 28, taskId: 'new', sessionId: 'sess-new' },
  ]);

  const csv = await exportCSV(root);
  assert.match(csv, /ts,provider,model,promptTokens,completionTokens,totalTokens,costUsd,taskId,sessionId/);
  assert.match(csv, /gpt-4o/);

  const pruned = await pruneUsage(root, 30);
  assert.equal(pruned.removed, 1);
  const remaining = await readFile(getTokenUsageFilePath(root), 'utf8');
  assert.match(remaining, /sess-new/);
  assert.doesNotMatch(remaining, /sess-old/);

  const cache = await getCache(root);
  assert.equal(cache.total.allTime.total, 28);
});
