import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from './security.js';
import { readProjectPolicy } from './policy.js';

const STATS_DIR_NAME = '.local-codex';
const EVENTS_FILE_NAME = 'events.jsonl';
const STATS_FILE_NAME = 'stats.json';
const TEST_RUNS_FILE_NAME = 'test-runs.jsonl';
const TEST_RUNS_DIR_NAME = 'test-runs';
const TASKS_DIR_NAME = path.join('.local-codex', 'tasks');
const PATCHES_DIR_NAME = path.join('.local-codex', 'patches');
const STATS_SCHEMA_VERSION = 1;
const STATS_TTL_MS = 60 * 60 * 1000;
const STATS_POLICY_CACHE_TTL_MS = 5000;

const DEFAULT_STATS_CONFIG = {
  enabled: true,
  trackTokens: true,
  autoRefreshIntervalHours: 1,
  pruneAfterDays: 90,
  eventsFile: path.join('.local-codex', EVENTS_FILE_NAME),
  statsFile: path.join('.local-codex', STATS_FILE_NAME),
};

const statsPolicyCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.writeFile(tempPath, content, encoding).then(() => fs.rename(tempPath, filePath));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function toUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function clampNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return '0с';
  }
  const totalSeconds = Math.round(duration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}ч ${String(minutes).padStart(2, '0')}мин`;
  }
  if (minutes > 0) {
    return `${minutes}мин ${String(seconds).padStart(2, '0')}с`;
  }
  return `${seconds}с`;
}

function normalizeRootPath(projectRoot) {
  return normalizeRoot(projectRoot || process.cwd());
}

function getStatsRoot(projectRoot) {
  return path.join(normalizeRootPath(projectRoot), STATS_DIR_NAME);
}

export function getEventsFilePath(projectRoot) {
  return path.join(getStatsRoot(projectRoot), EVENTS_FILE_NAME);
}

export function getStatsFilePath(projectRoot) {
  return path.join(getStatsRoot(projectRoot), STATS_FILE_NAME);
}

function getTasksIndexPath(projectRoot) {
  return path.join(normalizeRootPath(projectRoot), TASKS_DIR_NAME, 'index.json');
}

function getTaskAutoRunDir(projectRoot, taskEntry) {
  const location = taskEntry?.location || 'active';
  const id = taskEntry?.id || '';
  return path.join(normalizeRootPath(projectRoot), TASKS_DIR_NAME, location, id, 'auto-runs');
}

function getTaskCurrentAutoRunPath(projectRoot, taskEntry) {
  const location = taskEntry?.location || 'active';
  const id = taskEntry?.id || '';
  return path.join(normalizeRootPath(projectRoot), TASKS_DIR_NAME, location, id, 'auto-run.json');
}

function getPatchRoot(projectRoot) {
  return path.join(normalizeRootPath(projectRoot), PATCHES_DIR_NAME);
}

async function readJsonLines(filePath) {
  if (!(await fileExists(filePath))) {
    return [];
  }
  const raw = await readTextFile(filePath, '');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function writeJsonLines(filePath, entries) {
  await ensureDir(path.dirname(filePath));
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
}

async function appendJsonLine(filePath, entry) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function normalizeStatsConfig(policy = {}) {
  const stats = policy.stats || {};
  return {
    enabled: stats.enabled !== false,
    trackTokens: stats.trackTokens !== false,
    autoRefreshIntervalHours: Number.isFinite(Number(stats.autoRefreshIntervalHours)) && Number(stats.autoRefreshIntervalHours) > 0
      ? Math.floor(Number(stats.autoRefreshIntervalHours))
      : DEFAULT_STATS_CONFIG.autoRefreshIntervalHours,
    pruneAfterDays: Number.isFinite(Number(stats.pruneAfterDays)) && Number(stats.pruneAfterDays) > 0
      ? Math.floor(Number(stats.pruneAfterDays))
      : DEFAULT_STATS_CONFIG.pruneAfterDays,
    eventsFile: typeof stats.eventsFile === 'string' && stats.eventsFile.trim()
      ? stats.eventsFile.trim()
      : DEFAULT_STATS_CONFIG.eventsFile,
    statsFile: typeof stats.statsFile === 'string' && stats.statsFile.trim()
      ? stats.statsFile.trim()
      : DEFAULT_STATS_CONFIG.statsFile,
  };
}

async function getStatsConfig(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const cached = statsPolicyCache.get(root);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  let config = normalizeStatsConfig({});
  try {
    const policy = await readProjectPolicy(root);
    config = normalizeStatsConfig(policy);
  } catch {
    // Use defaults when policy cannot be read.
  }
  statsPolicyCache.set(root, {
    value: config,
    expiresAt: now + STATS_POLICY_CACHE_TTL_MS,
  });
  return config;
}

function sanitizeTrackedEvent(event, statsConfig) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const type = typeof event.type === 'string' ? event.type.trim() : '';
  if (!type) {
    return null;
  }
  const next = {
    ...event,
    type,
    ts: typeof event.ts === 'string' && event.ts.trim() ? event.ts.trim() : nowIso(),
  };
  if (type === 'provider.request') {
    const promptTokens = Number.isFinite(Number(event.promptTokens)) ? Math.max(0, Math.floor(Number(event.promptTokens))) : null;
    const completionTokens = Number.isFinite(Number(event.completionTokens)) ? Math.max(0, Math.floor(Number(event.completionTokens))) : null;
    if (statsConfig.trackTokens) {
      if (promptTokens !== null) next.promptTokens = promptTokens;
      if (completionTokens !== null) next.completionTokens = completionTokens;
    } else {
      delete next.promptTokens;
      delete next.completionTokens;
    }
  }
  return next;
}

async function readEventEntries(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const entries = await readJsonLines(getEventsFilePath(root));
  entries.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return entries;
}

function filterByRange(entries, options = {}) {
  const fromTs = options.from ? parseTimestamp(options.from) : null;
  const toTs = options.to ? parseTimestamp(options.to) : null;
  return entries.filter((entry) => {
    const ts = parseTimestamp(entry.ts);
    if (ts === null) {
      return true;
    }
    if (fromTs !== null && ts < fromTs) {
      return false;
    }
    if (toTs !== null && ts > toTs) {
      return false;
    }
    return true;
  });
}

function isWithinRange(timestamp, options = {}) {
  const fromTs = options.from ? parseTimestamp(options.from) : null;
  const toTs = options.to ? parseTimestamp(options.to) : null;
  if (timestamp === null) {
    return true;
  }
  if (fromTs !== null && timestamp < fromTs) {
    return false;
  }
  if (toTs !== null && timestamp > toTs) {
    return false;
  }
  return true;
}

function countByDay(entries, tsField = 'ts', valueField = 'count', options = {}) {
  const fromTs = options.from ? parseTimestamp(options.from) : null;
  const toTs = options.to ? parseTimestamp(options.to) : null;
  const counts = new Map();
  for (const entry of entries) {
    const ts = parseTimestamp(entry[tsField]);
    if (ts === null) {
      continue;
    }
    if (fromTs !== null && ts < fromTs) {
      continue;
    }
    if (toTs !== null && ts > toTs) {
      continue;
    }
    const day = toUtcDay(entry[tsField]);
    if (!day) {
      continue;
    }
    counts.set(day, (counts.get(day) || 0) + (Number(entry[valueField]) || 1));
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function countByKey(entries, keySelector, valueSelector = () => 1) {
  const counts = new Map();
  for (const entry of entries) {
    const key = keySelector(entry);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + valueSelector(entry));
  }
  return counts;
}

function topEntriesFromCounts(counts, valueKey, limit = 10) {
  return [...counts.entries()]
    .map(([key, value]) => ({ [valueKey]: key, taskCount: value }))
    .sort((a, b) => b.taskCount - a.taskCount || String(a[valueKey]).localeCompare(String(b[valueKey])))
    .slice(0, limit);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return 0;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatDayLabel(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function formatSectionHeader(title, period) {
  const lines = [
    title,
    `Период: ${period.from} → ${period.to}`,
    `Сгенерировано: ${period.generatedAt}`,
    '────────────────────────────────────────────',
  ];
  return lines.join('\n');
}

function formatTasksSection(stats) {
  const tasks = stats.tasks || {};
  const doneRate = tasks.total ? (tasks.byStatus.done / tasks.total) : 0;
  return [
    'ЗАДАЧИ',
    `  Всего           ${tasks.total || 0}`,
    `  Активные        ${tasks.byStatus.active || 0}`,
    `  Завершённые     ${tasks.byStatus.done || 0}   (${formatPercent(doneRate)})`,
    `  В архиве        ${tasks.byStatus.archived || 0}`,
    `  Среднее время   ${formatDurationMs(tasks.avgCompletionMs || 0)}`,
  ].join('\n');
}

function formatPatchesSection(stats) {
  const patches = stats.patches || {};
  return [
    'ПАТЧИ',
    `  Всего           ${patches.total || 0}`,
    `  Применено       ${patches.applied || 0}   (${formatPercent(patches.acceptRate || 0)})`,
    `  Отклонено       ${patches.rejected || 0}`,
    `  Откаты          ${patches.rolledBack || 0}`,
  ].join('\n');
}

function formatTestsSection(stats) {
  const tests = stats.tests || {};
  const passRate = tests.total ? (tests.passed / tests.total) : 0;
  const runnerText = Array.isArray(tests.runnerBreakdown) && tests.runnerBreakdown.length
    ? tests.runnerBreakdown.map((entry) => `${entry.runner} ${entry.count}`).join('  ')
    : '—';
  return [
    'ТЕСТЫ',
    `  Прогонов        ${tests.total || 0}`,
    `  Успешных        ${tests.passed || 0}  (${formatPercent(passRate)})`,
    `  Провальных      ${tests.failed || 0}`,
    `  Ошибок          ${tests.errored || 0}`,
    `  Среднее время   ${formatDurationMs(tests.avgDurationMs || 0)}`,
    `  Раннеры         ${runnerText}`,
  ].join('\n');
}

function formatAutoRunsSection(stats) {
  const autoRuns = stats.autoRuns || {};
  const successRate = autoRuns.total ? (autoRuns.completed / autoRuns.total) : 0;
  return [
    'АВТО-РЕЖИМ',
    `  Всего           ${autoRuns.total || 0}`,
    `  Завершено       ${autoRuns.completed || 0}   (${formatPercent(successRate)})`,
    `  Прервано        ${autoRuns.aborted || 0}`,
    `  Провалено       ${autoRuns.failed || 0}`,
    `  Шагов всего     ${autoRuns.totalSteps || 0}   (${(autoRuns.avgStepsPerRun || 0).toFixed(1)} avg/run)`,
  ].join('\n');
}

function formatProvidersSection(stats) {
  const providers = stats.providers || {};
  const usage = Array.isArray(providers.usage) ? providers.usage : [];
  const totalRequests = usage.reduce((sum, entry) => sum + (Number(entry.requests) || 0), 0);
  return [
    'ПРОВАЙДЕРЫ',
    ...usage.slice(0, 5).map((entry) => {
      const share = totalRequests ? formatPercent((Number(entry.requests) || 0) / totalRequests) : '0%';
      return `  ${entry.provider}/${entry.model}    ${entry.requests || 0} запросов   (${share})`;
    }),
    !usage.length ? '  —' : null,
  ].filter(Boolean).join('\n');
}

function formatTokensSection(stats) {
  const tokens = stats.tokens || {};
  return [
    'ТОКЕНЫ (если доступно)',
    `  Prompt         ${Number(tokens.totalPrompt || 0).toLocaleString('ru-RU')}`,
    `  Completion     ${Number(tokens.totalCompletion || 0).toLocaleString('ru-RU')}`,
  ].join('\n');
}

function formatTopFilesSection(stats) {
  const files = topFiles(stats, 5);
  return [
    'ТОП ФАЙЛОВ (по задачам)',
    ...files.map((entry, index) => `  ${index + 1}. ${entry.path.padEnd(20)} ${entry.taskCount} задач`),
    !files.length ? '  —' : null,
  ].filter(Boolean).join('\n');
}

function formatSection(stats, section) {
  switch (section) {
    case 'tasks':
      return formatTasksSection(stats);
    case 'patches':
      return formatPatchesSection(stats);
    case 'tests':
      return formatTestsSection(stats);
    case 'auto':
      return formatAutoRunsSection(stats);
    case 'providers':
      return formatProvidersSection(stats);
    case 'tokens':
      return formatTokensSection(stats);
    case 'top-files':
      return formatTopFilesSection(stats);
    case 'all':
    default:
      return [
        formatTasksSection(stats),
        '',
        formatPatchesSection(stats),
        '',
        formatTestsSection(stats),
        '',
        formatAutoRunsSection(stats),
        '',
        formatProvidersSection(stats),
        '',
        formatTokensSection(stats),
        '',
        formatTopFilesSection(stats),
      ].join('\n');
  }
}

async function readTasksIndex(projectRoot) {
  const index = await readJsonFile(getTasksIndexPath(projectRoot), null);
  return {
    tasks: Array.isArray(index?.tasks) ? index.tasks : [],
    currentTaskId: index?.currentTaskId || null,
    updatedAt: index?.updatedAt || null,
  };
}

async function readPatchArtifacts(projectRoot) {
  const root = getPatchRoot(projectRoot);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const patches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const patch = await readJsonFile(path.join(root, entry.name, 'patch.json'), null);
    if (patch) {
      patches.push(patch);
    }
  }
  return patches;
}

async function readAutoRuns(projectRoot, tasks) {
  const runs = [];
  const seen = new Set();
  for (const task of tasks) {
    const runDir = getTaskAutoRunDir(projectRoot, task);
    const currentPath = getTaskCurrentAutoRunPath(projectRoot, task);
    const current = await readJsonFile(currentPath, null);
    if (current?.runId && !seen.has(current.runId)) {
      seen.add(current.runId);
      runs.push(current);
    }
    const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const run = await readJsonFile(path.join(runDir, entry.name), null);
      if (run?.runId && !seen.has(run.runId)) {
        seen.add(run.runId);
        runs.push(run);
      }
    }
  }
  return runs;
}

function aggregateTasks(tasks, options = {}) {
  let total = 0;
  const byStatus = {
    active: 0,
    done: 0,
    archived: 0,
  };
  const completionDurations = [];
  const createdByDay = new Map();
  const fileCounts = new Map();
  const timestamps = [];

  for (const task of tasks) {
    const createdAtTs = parseTimestamp(task.createdAt);
    const updatedAtTs = parseTimestamp(task.updatedAt);
    const inRange = isWithinRange(createdAtTs, options)
      || isWithinRange(updatedAtTs, options);
    if (!inRange) {
      continue;
    }
    const status = String(task.status || 'draft').trim().toLowerCase();
    if (status === 'done') {
      byStatus.done += 1;
    } else if (status === 'archived') {
      byStatus.archived += 1;
    } else {
      byStatus.active += 1;
    }

    const createdAt = parseTimestamp(task.createdAt);
    const updatedAt = parseTimestamp(task.updatedAt);
    if (createdAt !== null) {
      timestamps.push(createdAt);
      const day = toUtcDay(task.createdAt);
      if (day) {
        createdByDay.set(day, (createdByDay.get(day) || 0) + 1);
      }
    }
    if (updatedAt !== null) {
      timestamps.push(updatedAt);
    }
    if ((status === 'done' || status === 'archived') && createdAt !== null && updatedAt !== null && updatedAt >= createdAt) {
      completionDurations.push(updatedAt - createdAt);
    }

    const files = new Set(Array.isArray(task.relevantFiles) ? task.relevantFiles.filter(Boolean) : []);
    for (const file of files) {
      fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    }
    total += 1;
  }

  return {
    total,
    byStatus,
    createdByDay: [...createdByDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    avgCompletionMs: average(completionDurations),
    topFiles: topEntriesFromCounts(fileCounts, 'path', 10),
    timestamps,
  };
}

function aggregatePatches(patches, events, options = {}) {
  const filtered = patches.filter((patch) => {
    const timestamps = [
      patch.createdAt,
      patch.updatedAt,
      patch.appliedAt,
      patch.rejectedAt,
      patch.rolledBackAt,
    ].map((value) => parseTimestamp(value)).filter((value) => value !== null);
    if (!timestamps.length) {
      return true;
    }
    return timestamps.some((timestamp) => isWithinRange(timestamp, options));
  });
  const applied = filtered.filter((patch) => patch.status === 'applied').length;
  const rejected = filtered.filter((patch) => patch.status === 'rejected').length;
  const rolledBack = filtered.filter((patch) => patch.status === 'rolled_back').length;
  const total = filtered.length;
  const appliedByDay = countByDay(events.filter((event) => event.type === 'patch.applied'), 'ts', 'count', options);
  return {
    total,
    applied,
    rejected,
    rolledBack,
    acceptRate: total ? applied / total : 0,
    appliedByDay,
    timestamps: filtered.flatMap((patch) => [
      patch.createdAt,
      patch.updatedAt,
      patch.appliedAt,
      patch.rejectedAt,
      patch.rolledBackAt,
    ].filter(Boolean)),
  };
}

function aggregateTests(testRuns, options = {}) {
  const filtered = testRuns.filter((run) => {
    const timestamps = [run.startedAt, run.completedAt].map((value) => parseTimestamp(value)).filter((value) => value !== null);
    if (!timestamps.length) {
      return true;
    }
    return timestamps.some((timestamp) => isWithinRange(timestamp, options));
  });
  const counts = {
    total: filtered.length,
    passed: 0,
    failed: 0,
    errored: 0,
    timeout: 0,
    skipped: 0,
  };
  const durations = [];
  const runsByDay = new Map();
  const runnerCounts = new Map();
  const timestamps = [];

  for (const run of filtered) {
    const status = String(run.status || '').trim().toLowerCase();
    if (status === 'passed') counts.passed += 1;
    else if (status === 'failed') counts.failed += 1;
    else if (status === 'error') counts.errored += 1;
    else if (status === 'timeout') counts.timeout += 1;
    else if (status === 'skipped') counts.skipped += 1;

    if (Number.isFinite(Number(run.duration))) {
      durations.push(Number(run.duration));
    }
    if (run.startedAt) {
      const day = toUtcDay(run.startedAt);
      if (day) {
        runsByDay.set(day, (runsByDay.get(day) || 0) + 1);
      }
      const parsed = parseTimestamp(run.startedAt);
      if (parsed !== null) {
        timestamps.push(parsed);
      }
    }
    if (run.completedAt) {
      const parsed = parseTimestamp(run.completedAt);
      if (parsed !== null) {
        timestamps.push(parsed);
      }
    }
    if (run.runner) {
      runnerCounts.set(run.runner, (runnerCounts.get(run.runner) || 0) + 1);
    }
  }

  return {
    ...counts,
    passRate: counts.total ? counts.passed / counts.total : 0,
    avgDurationMs: average(durations),
    runsByDay: [...runsByDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    runnerBreakdown: [...runnerCounts.entries()]
      .map(([runner, count]) => ({ runner, count }))
      .sort((a, b) => b.count - a.count || a.runner.localeCompare(b.runner)),
    timestamps,
  };
}

function aggregateAutoRuns(autoRuns, options = {}) {
  const filtered = autoRuns.filter((run) => {
    const timestamps = [run.startedAt, run.completedAt].map((value) => parseTimestamp(value)).filter((value) => value !== null);
    if (!timestamps.length) {
      return true;
    }
    return timestamps.some((timestamp) => isWithinRange(timestamp, options));
  });
  const counts = {
    total: filtered.length,
    completed: 0,
    aborted: 0,
    failed: 0,
    totalSteps: 0,
  };
  const durations = [];
  const timestamps = [];

  for (const run of filtered) {
    const status = String(run.status || '').trim().toLowerCase();
    if (status === 'completed') counts.completed += 1;
    else if (status === 'aborted') counts.aborted += 1;
    else if (status === 'failed') counts.failed += 1;
    counts.totalSteps += Array.isArray(run.plan) ? run.plan.length : 0;
    if (run.startedAt) {
      const parsed = parseTimestamp(run.startedAt);
      if (parsed !== null) timestamps.push(parsed);
    }
    if (run.completedAt) {
      const parsed = parseTimestamp(run.completedAt);
      if (parsed !== null) timestamps.push(parsed);
    }
    if (run.startedAt && run.completedAt) {
      const start = parseTimestamp(run.startedAt);
      const end = parseTimestamp(run.completedAt);
      if (start !== null && end !== null && end >= start) {
        durations.push(end - start);
      }
    }
  }

  return {
    ...counts,
    avgStepsPerRun: counts.total ? counts.totalSteps / counts.total : 0,
    avgDurationMs: average(durations),
    timestamps,
  };
}

function aggregateProviders(events, options = {}) {
  const filtered = filterByRange(events.filter((event) => event.type === 'provider.request'), options);
  const byProvider = new Map();
  const tokenTotals = new Map();

  for (const event of filtered) {
    const provider = String(event.provider || 'unknown').trim() || 'unknown';
    const model = String(event.model || 'unknown').trim() || 'unknown';
    const key = `${provider}::${model}`;
    const requestCount = Number(event.requests) || 1;
    const promptTokens = Number(event.promptTokens) || 0;
    const completionTokens = Number(event.completionTokens) || 0;
    const current = byProvider.get(key) || {
      provider,
      model,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
    current.requests += requestCount;
    current.promptTokens += promptTokens;
    current.completionTokens += completionTokens;
    byProvider.set(key, current);

    const tokenEntry = tokenTotals.get(provider) || {
      provider,
      prompt: 0,
      completion: 0,
    };
    tokenEntry.prompt += promptTokens;
    tokenEntry.completion += completionTokens;
    tokenTotals.set(provider, tokenEntry);
  }

  const usage = [...byProvider.values()].sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  const topProvider = usage[0]?.provider || null;
  return {
    usage,
    topProvider,
    byProvider: [...tokenTotals.values()].sort((a, b) => b.prompt + b.completion - (a.prompt + a.completion) || a.provider.localeCompare(b.provider)),
    timestamps: filtered.map((event) => parseTimestamp(event.ts)).filter((value) => value !== null),
  };
}

function aggregateRoles(events, options = {}) {
  const filtered = filterByRange(events.filter((event) => event.type === 'role.used'), options);
  const counts = new Map();
  for (const event of filtered) {
    const role = String(event.role || '').trim();
    if (!role) {
      continue;
    }
    counts.set(role, (counts.get(role) || 0) + 1);
  }
  const usage = [...counts.entries()]
    .map(([role, sessions]) => ({ role, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.role.localeCompare(b.role));
  return {
    usage,
    topRole: usage[0]?.role || null,
    timestamps: filtered.map((event) => parseTimestamp(event.ts)).filter((value) => value !== null),
  };
}

function aggregateTokens(events, options = {}) {
  const filtered = filterByRange(events.filter((event) => event.type === 'provider.request'), options);
  const byProvider = new Map();
  let totalPrompt = 0;
  let totalCompletion = 0;
  for (const event of filtered) {
    const provider = String(event.provider || 'unknown').trim() || 'unknown';
    const prompt = Number(event.promptTokens) || 0;
    const completion = Number(event.completionTokens) || 0;
    totalPrompt += prompt;
    totalCompletion += completion;
    const entry = byProvider.get(provider) || {
      provider,
      prompt: 0,
      completion: 0,
    };
    entry.prompt += prompt;
    entry.completion += completion;
    byProvider.set(provider, entry);
  }
  return {
    totalPrompt,
    totalCompletion,
    byProvider: [...byProvider.values()].sort((a, b) => b.prompt + b.completion - (a.prompt + a.completion) || a.provider.localeCompare(b.provider)),
    timestamps: filtered.map((event) => parseTimestamp(event.ts)).filter((value) => value !== null),
  };
}

function gatherTimestamps(...groups) {
  const timestamps = [];
  for (const group of groups) {
    if (!group) {
      continue;
    }
    if (Array.isArray(group)) {
      for (const value of group) {
        if (value) {
          const parsed = parseTimestamp(value);
          if (parsed !== null) {
            timestamps.push(parsed);
          }
        }
      }
      continue;
    }
    if (typeof group === 'object') {
      for (const value of Object.values(group)) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (entry && typeof entry === 'object') {
              for (const nested of Object.values(entry)) {
                if (typeof nested === 'string' || typeof nested === 'number') {
                  const parsed = parseTimestamp(nested);
                  if (parsed !== null) {
                    timestamps.push(parsed);
                  }
                }
              }
            } else if (typeof entry === 'string' || typeof entry === 'number') {
              const parsed = parseTimestamp(entry);
              if (parsed !== null) {
                timestamps.push(parsed);
              }
            }
          }
        } else if (typeof value === 'string' || typeof value === 'number') {
          const parsed = parseTimestamp(value);
          if (parsed !== null) {
            timestamps.push(parsed);
          }
        }
      }
    }
  }
  return timestamps;
}

function resolvePeriod(options, timestamps) {
  const now = nowIso();
  const minTimestamp = timestamps.length ? Math.min(...timestamps) : null;
  const maxTimestamp = timestamps.length ? Math.max(...timestamps) : null;
  return {
    from: options.from || (minTimestamp !== null ? new Date(minTimestamp).toISOString() : now),
    to: options.to || (maxTimestamp !== null ? new Date(maxTimestamp).toISOString() : now),
  };
}

async function writeStats(projectRoot, stats) {
  const root = normalizeRootPath(projectRoot);
  await ensureDir(getStatsRoot(root));
  await atomicWriteFile(getStatsFilePath(root), `${JSON.stringify(stats, null, 2)}\n`);
  return stats;
}

async function getLatestEventTimestamp(projectRoot) {
  const entries = await readJsonLines(getEventsFilePath(projectRoot));
  const last = entries[entries.length - 1];
  return last?.ts || null;
}

export async function trackEvent(projectRoot, event) {
  const root = normalizeRootPath(projectRoot);
  const statsConfig = await getStatsConfig(root);
  if (!statsConfig.enabled) {
    return null;
  }
  const normalized = sanitizeTrackedEvent(event, statsConfig);
  if (!normalized) {
    return null;
  }
  try {
    await ensureDir(getStatsRoot(root));
    await appendJsonLine(getEventsFilePath(root), normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function readStats(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const file = getStatsFilePath(root);
  if (!(await fileExists(file))) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function listEvents(projectRoot, options = {}) {
  const root = normalizeRootPath(projectRoot);
  const events = await readJsonLines(getEventsFilePath(root));
  const filtered = options.type
    ? events.filter((event) => {
      if (Array.isArray(options.type)) {
        return options.type.includes(event.type);
      }
      return event.type === options.type;
    })
    : events;
  const ordered = options.reverse === false ? [...filtered] : [...filtered].reverse();
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.floor(Number(options.limit))
    : ordered.length;
  return ordered.slice(0, limit);
}

export async function refreshStats(projectRoot, options = {}) {
  const root = normalizeRootPath(projectRoot);
  const statsConfig = await getStatsConfig(root);
  if (!statsConfig.enabled) {
    const empty = {
      version: STATS_SCHEMA_VERSION,
      generatedAt: nowIso(),
      period: {
        from: options.from || nowIso(),
        to: options.to || nowIso(),
      },
      tasks: {
        total: 0,
        byStatus: { active: 0, done: 0, archived: 0 },
        createdByDay: [],
        avgCompletionMs: 0,
        topFiles: [],
      },
      patches: {
        total: 0,
        applied: 0,
        rejected: 0,
        rolledBack: 0,
        acceptRate: 0,
        appliedByDay: [],
      },
      tests: {
        total: 0,
        passed: 0,
        failed: 0,
        errored: 0,
        timeout: 0,
        skipped: 0,
        passRate: 0,
        avgDurationMs: 0,
        runsByDay: [],
        runnerBreakdown: [],
      },
      autoRuns: {
        total: 0,
        completed: 0,
        aborted: 0,
        failed: 0,
        totalSteps: 0,
        avgStepsPerRun: 0,
        avgDurationMs: 0,
      },
      providers: {
        usage: [],
        topProvider: null,
      },
      roles: {
        usage: [],
        topRole: null,
      },
      tokens: {
        totalPrompt: 0,
        totalCompletion: 0,
        byProvider: [],
      },
    };
    await writeStats(root, empty);
    return empty;
  }

  const [events, tasksIndex, patchArtifacts, testRuns] = await Promise.all([
    readEventEntries(root),
    readTasksIndex(root),
    readPatchArtifacts(root),
    readJsonLines(path.join(root, STATS_DIR_NAME, TEST_RUNS_FILE_NAME)),
  ]);
  const taskStats = aggregateTasks(tasksIndex.tasks, options);
  const autoRuns = await readAutoRuns(root, tasksIndex.tasks);
  const autoRunStats = aggregateAutoRuns(autoRuns, options);
  const patchStats = aggregatePatches(patchArtifacts, events, options);
  const testStats = aggregateTests(testRuns, options);
  const providerStats = aggregateProviders(events, options);
  const roleStats = aggregateRoles(events, options);
  const tokenStats = aggregateTokens(events, options);

  const period = resolvePeriod(options, gatherTimestamps(
    taskStats.timestamps,
    patchStats.timestamps,
    testStats.timestamps,
    autoRunStats.timestamps,
    providerStats.timestamps,
    roleStats.timestamps,
    tokenStats.timestamps,
    events.map((entry) => entry.ts),
  ));

  const stats = {
    version: STATS_SCHEMA_VERSION,
    generatedAt: nowIso(),
    period,
    tasks: {
      total: taskStats.total,
      byStatus: taskStats.byStatus,
      createdByDay: taskStats.createdByDay,
      avgCompletionMs: taskStats.avgCompletionMs,
      topFiles: taskStats.topFiles,
    },
    patches: {
      total: patchStats.total,
      applied: patchStats.applied,
      rejected: patchStats.rejected,
      rolledBack: patchStats.rolledBack,
      acceptRate: patchStats.acceptRate,
      appliedByDay: patchStats.appliedByDay,
    },
    tests: {
      total: testStats.total,
      passed: testStats.passed,
      failed: testStats.failed,
      errored: testStats.errored,
      timeout: testStats.timeout,
      skipped: testStats.skipped,
      passRate: testStats.passRate,
      avgDurationMs: testStats.avgDurationMs,
      runsByDay: testStats.runsByDay,
      runnerBreakdown: testStats.runnerBreakdown,
    },
    autoRuns: {
      total: autoRunStats.total,
      completed: autoRunStats.completed,
      aborted: autoRunStats.aborted,
      failed: autoRunStats.failed,
      totalSteps: autoRunStats.totalSteps,
      avgStepsPerRun: autoRunStats.avgStepsPerRun,
      avgDurationMs: autoRunStats.avgDurationMs,
    },
    providers: {
      usage: providerStats.usage,
      topProvider: providerStats.topProvider,
    },
    roles: {
      usage: roleStats.usage,
      topRole: roleStats.topRole,
    },
    tokens: {
      totalPrompt: tokenStats.totalPrompt,
      totalCompletion: tokenStats.totalCompletion,
      byProvider: tokenStats.byProvider,
    },
  };

  await writeStats(root, stats);
  return stats;
}

export async function getStats(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const existing = await readStats(root);
  if (!existing) {
    return refreshStats(root);
  }
  const statsConfig = await getStatsConfig(root);
  const generatedAt = parseTimestamp(existing.generatedAt);
  const latestEvent = parseTimestamp(await getLatestEventTimestamp(root));
  const expiresAt = generatedAt !== null
    ? generatedAt + (statsConfig.autoRefreshIntervalHours * 60 * 60 * 1000)
    : 0;
  const stale = generatedAt === null
    || Date.now() > expiresAt
    || (latestEvent !== null && generatedAt !== null && latestEvent > generatedAt);
  if (stale) {
    return refreshStats(root);
  }
  return existing;
}

export async function pruneEvents(projectRoot, keepDays = DEFAULT_STATS_CONFIG.pruneAfterDays) {
  const root = normalizeRootPath(projectRoot);
  const eventsPath = getEventsFilePath(root);
  const entries = await readJsonLines(eventsPath);
  if (!entries.length) {
    return { removed: 0, kept: 0 };
  }
  const days = Number.isFinite(Number(keepDays)) && Number(keepDays) > 0
    ? Math.floor(Number(keepDays))
    : DEFAULT_STATS_CONFIG.pruneAfterDays;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const kept = entries.filter((entry) => {
    const ts = parseTimestamp(entry.ts);
    return ts === null ? true : ts >= cutoff;
  });
  const removed = entries.length - kept.length;
  await writeJsonLines(eventsPath, kept);
  return { removed, kept: kept.length };
}

export function topFiles(stats, n = 10) {
  const items = Array.isArray(stats?.tasks?.topFiles) ? stats.tasks.topFiles : [];
  const limit = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 10;
  return items.slice(0, limit);
}

export function formatStatsReport(stats, options = {}) {
  const section = String(options.section || 'all').trim().toLowerCase();
  const period = {
    from: stats?.period?.from ? formatDayLabel(stats.period.from.slice(0, 10)) : '—',
    to: stats?.period?.to ? formatDayLabel(stats.period.to.slice(0, 10)) : '—',
    generatedAt: stats?.generatedAt ? new Date(stats.generatedAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) : '—',
  };
  const lines = [
    formatSectionHeader('WorkBench — статистика проекта', period),
    formatSection(stats, section),
    '────────────────────────────────────────────',
  ];
  return lines.join('\n');
}

export { DEFAULT_STATS_CONFIG };
