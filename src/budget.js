import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from './security.js';
import { emitter } from './events.js';
import { readProjectPolicy } from './policy.js';

const BUDGET_DIR_NAME = '.local-codex';
const USAGE_FILE_NAME = 'token-usage.jsonl';
const CACHE_FILE_NAME = 'budget-cache.json';
const POLICY_CACHE_TTL_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_BUDGET_CONFIG = {
  enabled: true,
  limits: {
    openai: {
      daily: 500000,
      weekly: 2000000,
      monthly: 8000000,
    },
    anthropic: {
      daily: 300000,
      weekly: 1200000,
      monthly: 5000000,
    },
    gemini: {
      daily: 1000000,
      weekly: 4000000,
      monthly: 15000000,
    },
    ollama: {
      daily: null,
      weekly: null,
      monthly: null,
    },
    total: {
      daily: 1000000,
      weekly: 4000000,
      monthly: 20000000,
    },
  },
  onExceed: 'warn',
  pricing: {
    openai: {
      'gpt-4o': { prompt: 2.5, completion: 10 },
      'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
      'gpt-4.1': { prompt: 2, completion: 8 },
      'gpt-4.1-mini': { prompt: 0.4, completion: 1.6 },
      'gpt-4.1-nano': { prompt: 0.1, completion: 0.4 },
      o3: { prompt: 10, completion: 40 },
      'o4-mini': { prompt: 1.1, completion: 4.4 },
    },
    anthropic: {
      'claude-opus-4-5': { prompt: 15, completion: 75 },
      'claude-sonnet-4-5': { prompt: 3, completion: 15 },
      'claude-haiku-3-5': { prompt: 0.8, completion: 4 },
    },
    gemini: {
      'gemini-2.5-pro': { prompt: 1.25, completion: 10 },
      'gemini-2.5-flash': { prompt: 0.15, completion: 0.6 },
      'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },
      'gemini-2.0-flash-lite': { prompt: 0.04, completion: 0.15 },
    },
    ollama: {},
  },
};

const budgetPolicyCache = new Map();
const budgetCacheMemo = new Map();

function nowIso() {
  return new Date().toISOString();
}

function parseTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function formatHourKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString().slice(0, 13).concat(':00:00Z');
}

function startOfUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now());
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now());
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function normalizeRootPath(projectRoot) {
  return normalizeRoot(projectRoot || process.cwd());
}

export function invalidateBudgetPolicyCache(projectRoot = null) {
  if (projectRoot) {
    budgetPolicyCache.delete(normalizeRootPath(projectRoot));
    return;
  }
  budgetPolicyCache.clear();
}

export function invalidateBudgetCache(projectRoot = null) {
  if (projectRoot) {
    budgetCacheMemo.delete(normalizeRootPath(projectRoot));
    return;
  }
  budgetCacheMemo.clear();
}

function getBudgetRoot(projectRoot) {
  return path.join(normalizeRootPath(projectRoot), BUDGET_DIR_NAME);
}

export function getTokenUsageFilePath(projectRoot) {
  return path.join(getBudgetRoot(projectRoot), USAGE_FILE_NAME);
}

export function getBudgetCachePath(projectRoot) {
  return path.join(getBudgetRoot(projectRoot), CACHE_FILE_NAME);
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

async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readTextFile(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, encoding);
  await fs.rename(tempPath, filePath);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeBudgetLimits(limits = {}) {
  const sections = ['openai', 'anthropic', 'gemini', 'ollama', 'total'];
  const next = {};
  for (const section of sections) {
    const source = limits[section] || DEFAULT_BUDGET_CONFIG.limits[section] || {};
    next[section] = {
      daily: normalizeNumber(source.daily),
      weekly: normalizeNumber(source.weekly),
      monthly: normalizeNumber(source.monthly),
    };
  }
  return next;
}

function normalizePricing(pricing = {}) {
  const next = {};
  for (const [provider, models] of Object.entries(DEFAULT_BUDGET_CONFIG.pricing)) {
    next[provider] = {};
    const source = pricing[provider] && typeof pricing[provider] === 'object' ? pricing[provider] : models;
    for (const [model, config] of Object.entries(source || {})) {
      next[provider][model] = {
        prompt: normalizeNumber(config?.prompt),
        completion: normalizeNumber(config?.completion),
      };
    }
  }
  for (const [provider, models] of Object.entries(pricing || {})) {
    if (next[provider]) {
      continue;
    }
    next[provider] = {};
    for (const [model, config] of Object.entries(models || {})) {
      next[provider][model] = {
        prompt: normalizeNumber(config?.prompt),
        completion: normalizeNumber(config?.completion),
      };
    }
  }
  return next;
}

function normalizeBudgetConfig(budget = {}) {
  return {
    ...DEFAULT_BUDGET_CONFIG,
    ...budget,
    enabled: budget.enabled !== false,
    onExceed: ['warn', 'block', 'ask'].includes(String(budget.onExceed || '').trim().toLowerCase())
      ? String(budget.onExceed).trim().toLowerCase()
      : DEFAULT_BUDGET_CONFIG.onExceed,
    limits: normalizeBudgetLimits(budget.limits || DEFAULT_BUDGET_CONFIG.limits),
    pricing: normalizePricing(budget.pricing || DEFAULT_BUDGET_CONFIG.pricing),
  };
}

async function getBudgetPolicy(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const cached = budgetPolicyCache.get(root);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  let budget = normalizeBudgetConfig(DEFAULT_BUDGET_CONFIG);
  try {
    const policy = await readProjectPolicy(root);
    budget = normalizeBudgetConfig(policy.budget || {});
  } catch {
    // Defaults stay in place.
  }
  budgetPolicyCache.set(root, {
    value: budget,
    expiresAt: now + POLICY_CACHE_TTL_MS,
  });
  return budget;
}

function createUsageSummary() {
  return {
    prompt: 0,
    completion: 0,
    total: 0,
    requests: 0,
    costUsd: 0,
  };
}

function normalizeUsageRecord(usageRecord = {}) {
  const provider = typeof usageRecord.provider === 'string' && usageRecord.provider.trim()
    ? usageRecord.provider.trim().toLowerCase()
    : 'unknown';
  const model = typeof usageRecord.model === 'string' && usageRecord.model.trim()
    ? usageRecord.model.trim()
    : null;
  const source = typeof usageRecord.source === 'string' && usageRecord.source.trim()
    ? usageRecord.source.trim().toLowerCase()
    : null;
  const promptTokens = normalizeNumber(usageRecord.promptTokens);
  const completionTokens = normalizeNumber(usageRecord.completionTokens);
  const totalTokens = normalizeNumber(usageRecord.totalTokens);
  const costUsd = normalizeNumber(usageRecord.costUsd);
  return {
    ts: typeof usageRecord.ts === 'string' && usageRecord.ts.trim() ? usageRecord.ts.trim() : nowIso(),
    provider,
    model,
    source,
    promptTokens,
    completionTokens,
    totalTokens: totalTokens !== null
      ? totalTokens
      : (promptTokens !== null || completionTokens !== null)
        ? (promptTokens || 0) + (completionTokens || 0)
        : null,
    taskId: typeof usageRecord.taskId === 'string' && usageRecord.taskId.trim() ? usageRecord.taskId.trim() : null,
    sessionId: typeof usageRecord.sessionId === 'string' && usageRecord.sessionId.trim() ? usageRecord.sessionId.trim() : null,
    costUsd,
    estimated: usageRecord.estimated === true,
  };
}

function computeCostUsd(record, pricing = {}) {
  const modelPricing = record.provider && record.model && pricing?.[record.provider]?.[record.model]
    ? pricing[record.provider][record.model]
    : null;
  if (!modelPricing) {
    return null;
  }
  if (record.promptTokens === null && record.completionTokens === null) {
    return null;
  }
  const prompt = record.promptTokens ?? 0;
  const completion = record.completionTokens ?? 0;
  const cost = ((prompt / 1_000_000) * (modelPricing.prompt || 0))
    + ((completion / 1_000_000) * (modelPricing.completion || 0));
  return Number.isFinite(cost) ? Number(cost.toFixed(6)) : null;
}

async function readUsageLines(filePath) {
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

function filterEntries(entries, options = {}) {
  const fromTs = options.from ? parseTimestamp(options.from) : null;
  const toTs = options.to ? parseTimestamp(options.to) : null;
  const provider = typeof options.provider === 'string' && options.provider.trim()
    ? options.provider.trim().toLowerCase()
    : null;
  const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
    ? Math.floor(Number(options.days))
    : null;
  const now = Date.now();
  const dayThreshold = days ? now - (days * DAY_MS) : null;

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
    if (dayThreshold !== null && ts < dayThreshold) {
      return false;
    }
    if (provider && String(entry.provider || '').toLowerCase() !== provider) {
      return false;
    }
    return true;
  });
}

export async function listUsageEntries(projectRoot, options = {}) {
  const root = normalizeRootPath(projectRoot);
  const entries = await readUsageLines(getTokenUsageFilePath(root));
  entries.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const filtered = filterEntries(entries, options);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.floor(Number(options.limit))
    : null;
  return limit ? filtered.slice(-limit) : filtered;
}

function updateSummary(summary, record) {
  summary.requests += 1;
  summary.prompt += record.promptTokens ?? 0;
  summary.completion += record.completionTokens ?? 0;
  summary.total += record.totalTokens ?? ((record.promptTokens ?? 0) + (record.completionTokens ?? 0));
  summary.costUsd += record.costUsd ?? 0;
}

function summarizeModelUsage(entries, providerName, period = 'all') {
  const provider = String(providerName || '').trim().toLowerCase();
  const buckets = new Map();
  for (const entry of entries) {
    if (provider && String(entry.provider || '').toLowerCase() !== provider) {
      continue;
    }
    const key = String(entry.model || 'unknown');
    const bucket = buckets.get(key) || createUsageSummary();
    updateSummary(bucket, entry);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([model, summary]) => ({
      model,
      period,
      ...summary,
    }))
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
}

function makePeriodMap(bucketKeys) {
  const map = new Map();
  for (const key of bucketKeys) {
    map.set(key, createUsageSummary());
  }
  return map;
}

function addToBucket(bucket, provider, record) {
  if (!Object.prototype.hasOwnProperty.call(bucket, provider)) {
    bucket[provider] = 0;
  }
  bucket[provider] += record.totalTokens ?? ((record.promptTokens ?? 0) + (record.completionTokens ?? 0));
  bucket.total += record.totalTokens ?? ((record.promptTokens ?? 0) + (record.completionTokens ?? 0));
}

function buildTimeseries(entries, { bucketType, bucketCount, bucketSizeMs, now }) {
  const valueKey = bucketType === 'hour' ? 'hour' : 'date';
  const buckets = [];
  const bucketIndex = new Map();
  const providerSet = new Set();
  const normalizedNow = new Date(now);
  const end = bucketType === 'hour' ? startOfUtcHour(normalizedNow) : startOfUtcDay(normalizedNow);
  const start = new Date(end.getTime() - ((bucketCount - 1) * bucketSizeMs));

  for (let index = 0; index < bucketCount; index += 1) {
    const current = new Date(start.getTime() + (index * bucketSizeMs));
    const key = bucketType === 'hour' ? formatHourKey(current) : formatDayKey(current);
    const item = {
      [valueKey]: key,
      total: 0,
    };
    buckets.push(item);
    bucketIndex.set(key, item);
  }

  for (const entry of entries) {
    const ts = parseTimestamp(entry.ts);
    if (ts === null) {
      continue;
    }
    const key = bucketType === 'hour'
      ? formatHourKey(ts)
      : formatDayKey(ts);
    const bucket = bucketIndex.get(key);
    if (!bucket) {
      continue;
    }
    const provider = String(entry.provider || 'unknown');
    const tokens = entry.totalTokens ?? ((entry.promptTokens ?? 0) + (entry.completionTokens ?? 0));
    providerSet.add(provider);
    bucket.total += tokens;
    bucket[provider] = (bucket[provider] || 0) + tokens;
  }

  for (const bucket of buckets) {
    for (const provider of providerSet) {
      if (!Object.prototype.hasOwnProperty.call(bucket, provider)) {
        bucket[provider] = 0;
      }
    }
  }

  return buckets;
}

function buildProviderCache(entries, providers, windows) {
  const byProvider = {};
  for (const provider of providers) {
    byProvider[provider] = {
      today: createUsageSummary(),
      week: createUsageSummary(),
      month: createUsageSummary(),
      allTime: createUsageSummary(),
    };
  }

  const total = {
    today: createUsageSummary(),
    week: createUsageSummary(),
    month: createUsageSummary(),
    allTime: createUsageSummary(),
  };

  const periodChecks = {
    today: (ts) => ts >= windows.today,
    week: (ts) => ts >= windows.week,
    month: (ts) => ts >= windows.month,
    allTime: () => true,
  };

  let minTs = null;
  for (const entry of entries) {
    const ts = parseTimestamp(entry.ts);
    if (ts === null) {
      continue;
    }
    if (minTs === null || ts < minTs) {
      minTs = ts;
    }
    const provider = String(entry.provider || 'unknown').toLowerCase();
    if (!byProvider[provider]) {
      byProvider[provider] = {
        today: createUsageSummary(),
        week: createUsageSummary(),
        month: createUsageSummary(),
        allTime: createUsageSummary(),
      };
    }
    for (const [period, passes] of Object.entries(periodChecks)) {
      if (!passes(ts)) {
        continue;
      }
      updateSummary(byProvider[provider][period], entry);
      updateSummary(total[period], entry);
    }
  }

  return { byProvider, total, minTs };
}

function finalizeTotals(summary) {
  return {
    prompt: Math.round(summary.prompt || 0),
    completion: Math.round(summary.completion || 0),
    total: Math.round(summary.total || 0),
    requests: Math.round(summary.requests || 0),
    costUsd: Number((summary.costUsd || 0).toFixed(6)),
  };
}

function finalizeProviderCache(raw) {
  const byProvider = {};
  for (const [provider, periods] of Object.entries(raw.byProvider)) {
    byProvider[provider] = {
      today: finalizeTotals(periods.today),
      week: finalizeTotals(periods.week),
      month: finalizeTotals(periods.month),
      allTime: finalizeTotals(periods.allTime),
    };
  }
  const total = {
    today: finalizeTotals(raw.total.today),
    week: finalizeTotals(raw.total.week),
    month: finalizeTotals(raw.total.month),
    allTime: finalizeTotals(raw.total.allTime),
  };
  return { byProvider, total };
}

export async function refreshCache(projectRoot, options = {}) {
  const root = normalizeRootPath(projectRoot);
  const budget = await getBudgetPolicy(root);
  const now = Number.isFinite(Number(options.now))
    ? Number(options.now)
    : Date.now();
  const entries = await listUsageEntries(root, {
    from: options.from || null,
    to: options.to || null,
    provider: options.provider || null,
    days: options.days || null,
  });
  const providerSet = new Set(Object.keys(budget.limits || {}).filter((name) => name !== 'total'));
  for (const entry of entries) {
    if (entry.provider) {
      providerSet.add(String(entry.provider).toLowerCase());
    }
  }
  const windows = {
    today: startOfUtcDay(now).getTime(),
    week: startOfUtcDay(now - (6 * DAY_MS)).getTime(),
    month: startOfUtcDay(now - (29 * DAY_MS)).getTime(),
  };
  const raw = buildProviderCache(entries, providerSet, windows);
  const finalized = finalizeProviderCache(raw);
  const hourly = buildTimeseries(entries, {
    bucketType: 'hour',
    bucketCount: 48,
    bucketSizeMs: HOUR_MS,
    now,
  });
  const daily = buildTimeseries(entries, {
    bucketType: 'day',
    bucketCount: 90,
    bucketSizeMs: DAY_MS,
    now,
  });
  const cache = {
    version: 1,
    generatedAt: nowIso(),
    period: {
      from: raw.minTs ? new Date(raw.minTs).toISOString() : null,
      to: new Date(now).toISOString(),
    },
    byProvider: finalized.byProvider,
    total: finalized.total,
    hourly,
    daily,
  };
  await ensureDir(getBudgetRoot(root));
  await atomicWriteFile(getBudgetCachePath(root), `${JSON.stringify(cache, null, 2)}\n`);
  budgetCacheMemo.set(root, {
    value: cache,
    cacheMtimeMs: Date.now(),
    usageMtimeMs: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return cache;
}

export async function getCache(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const usagePath = getTokenUsageFilePath(root);
  const cachePath = getBudgetCachePath(root);
  const [usageStat, cacheStat] = await Promise.all([
    statIfExists(usagePath),
    statIfExists(cachePath),
  ]);
  const memo = budgetCacheMemo.get(root);
  const now = Date.now();
  const needsRefresh = !cacheStat
    || !memo
    || memo.expiresAt <= now
    || (usageStat?.mtimeMs || 0) > (cacheStat?.mtimeMs || 0);
  if (needsRefresh) {
    return refreshCache(root);
  }
  if (memo && memo.cacheMtimeMs === cacheStat.mtimeMs && memo.expiresAt > now) {
    return memo.value;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    budgetCacheMemo.set(root, {
      value: parsed,
      cacheMtimeMs: cacheStat.mtimeMs,
      usageMtimeMs: usageStat?.mtimeMs || 0,
      expiresAt: now + CACHE_TTL_MS,
    });
    return parsed;
  } catch {
    return refreshCache(root);
  }
}

function buildLimitEntry({ scope, provider, period, used, limit }) {
  if (limit === null || limit === undefined) {
    return null;
  }
  const percentage = limit > 0 ? used / limit : 0;
  const label = scope === 'total'
    ? `TOTAL ${period}`
    : `${provider} ${period}`;
  return {
    scope,
    provider: provider || null,
    period,
    used,
    limit,
    percentage,
    label,
    message: `${label}: ${formatTokens(used)} / ${formatTokens(limit)} (${Math.round(percentage * 100)}%)`,
  };
}

export async function checkLimit(projectRoot, providerName) {
  const root = normalizeRootPath(projectRoot);
  const budget = await getBudgetPolicy(root);
  if (budget.enabled === false) {
    return {
      ok: true,
      warnings: [],
      exceeded: [],
      limits: budget.limits,
      cache: null,
    };
  }
  const cache = await getCache(root);
  const provider = String(providerName || 'unknown').trim().toLowerCase();
  const providerStats = cache.byProvider?.[provider] || {
    today: createUsageSummary(),
    week: createUsageSummary(),
    month: createUsageSummary(),
    allTime: createUsageSummary(),
  };
  const warnings = [];
  const exceeded = [];

  const periods = [
    ['today', 'daily'],
    ['week', 'weekly'],
    ['month', 'monthly'],
  ];

  for (const [periodKey, limitKey] of periods) {
    const providerLimit = budget.limits?.[provider]?.[limitKey] ?? null;
    const totalLimit = budget.limits?.total?.[limitKey] ?? null;
    const providerUsed = cache.byProvider?.[provider]?.[periodKey]?.total ?? providerStats[periodKey]?.total ?? 0;
    const totalUsed = cache.total?.[periodKey]?.total ?? 0;

    const providerEntry = buildLimitEntry({
      scope: 'provider',
      provider,
      period: periodKey,
      used: providerUsed,
      limit: providerLimit,
    });
    const totalEntry = buildLimitEntry({
      scope: 'total',
      provider: null,
      period: periodKey,
      used: totalUsed,
      limit: totalLimit,
    });

    for (const entry of [providerEntry, totalEntry].filter(Boolean)) {
      if (entry.percentage >= 1) {
        exceeded.push(entry);
        continue;
      }
      if (entry.percentage >= 0.85) {
        warnings.push(entry);
      }
    }
  }

  return {
    ok: exceeded.length === 0,
    warnings,
    exceeded,
    limits: budget.limits,
    cache,
  };
}

export function formatTokens(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '—';
  }
  if (number < 1000) {
    return String(Math.round(number));
  }
  if (number < 1000000) {
    return `${Number((number / 1000).toFixed(1)).toString().replace(/\.0$/, '')}K`;
  }
  return `${Number((number / 1000000).toFixed(2)).toString().replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}M`;
}

function getPeriodLabel(period) {
  switch (period) {
    case 'today':
      return 'Сегодня';
    case 'week':
      return 'Неделя';
    case 'month':
      return 'Месяц';
    default:
      return period;
  }
}

function formatPeriodSpend(summary, limit, { showCost = false } = {}) {
  const spend = formatTokens(summary.total);
  const limitText = limit === null || limit === undefined ? 'no limit' : formatTokens(limit);
  const costText = showCost && Number.isFinite(summary.costUsd) && summary.costUsd > 0
    ? ` / $${summary.costUsd.toFixed(2)}`
    : '';
  return `${spend} / ${limitText}${costText}`;
}

export function formatReport(cache, limits, options = {}) {
  const providerName = typeof options.provider === 'string' && options.provider.trim()
    ? options.provider.trim().toLowerCase()
    : null;
  const periodKey = ['today', 'week', 'month', 'all'].includes(String(options.period || '').trim())
    ? String(options.period || '').trim()
    : 'all';
  const showCost = options.showCost === true;
  const periods = periodKey === 'all' ? ['today', 'week', 'month'] : [periodKey];
  const lines = [];

  lines.push('Token Budget');
  lines.push('────────────────────────────────────────────────────────');
  if (providerName) {
    const entries = Array.isArray(options.entries) ? options.entries : [];
    const modelStats = summarizeModelBreakdown(entries, providerName);
    if (!modelStats.length) {
      lines.push(`Провайдер ${providerName}: нет данных`);
      return lines.join('\n');
    }
    lines.push(`${providerName} — детальная статистика`);
    lines.push('──────────────────────────────────────────');
    lines.push('Модель          Сегодня    Неделя    Месяц');
    for (const model of modelStats) {
      lines.push(`${model.model.padEnd(15)} ${formatTokens(model.today.total).padEnd(10)} ${formatTokens(model.week.total).padEnd(9)} ${formatTokens(model.month.total)}`);
    }
    return lines.join('\n');
  }

  lines.push(`                    Сегодня          Неделя          Месяц`);
  for (const [provider, stats] of Object.entries(cache.byProvider || {})) {
    const limit = limits?.[provider] || {};
    const todayLine = formatPeriodSpend(stats.today, limit.daily, { showCost });
    const weekLine = formatPeriodSpend(stats.week, limit.weekly, { showCost });
    const monthLine = formatPeriodSpend(stats.month, limit.monthly, { showCost });
    lines.push(`${provider.padEnd(10)}  total     ${todayLine.padEnd(18)} ${weekLine.padEnd(18)} ${monthLine}`);
  }
  const totalLine = formatPeriodSpend(cache.total.today, limits?.total?.daily, { showCost });
  const totalWeekLine = formatPeriodSpend(cache.total.week, limits?.total?.weekly, { showCost });
  const totalMonthLine = formatPeriodSpend(cache.total.month, limits?.total?.monthly, { showCost });
  lines.push('─────────────────────────────────────────────────────────────────');
  lines.push(`TOTAL               ${totalLine.padEnd(18)} ${totalWeekLine.padEnd(18)} ${totalMonthLine}`);
  return lines.join('\n');
}

export function summarizeByModel(entries, providerName, period = 'all') {
  const target = String(providerName || '').trim().toLowerCase();
  const filtered = entries.filter((entry) => !target || String(entry.provider || '').trim().toLowerCase() === target);
  const buckets = new Map();
  for (const entry of filtered) {
    const key = String(entry.model || 'unknown');
    const bucket = buckets.get(key) || {
      model: key,
      today: createUsageSummary(),
      week: createUsageSummary(),
      month: createUsageSummary(),
      all: createUsageSummary(),
    };
    updateSummary(bucket.all, entry);
    const ts = parseTimestamp(entry.ts);
    if (ts !== null) {
      if (ts >= startOfUtcDay(Date.now()).getTime()) {
        updateSummary(bucket.today, entry);
      }
      if (ts >= startOfUtcDay(Date.now() - (6 * DAY_MS)).getTime()) {
        updateSummary(bucket.week, entry);
      }
      if (ts >= startOfUtcDay(Date.now() - (29 * DAY_MS)).getTime()) {
        updateSummary(bucket.month, entry);
      }
    }
    buckets.set(key, bucket);
  }
  const periodKey = ['today', 'week', 'month', 'all'].includes(period) ? period : 'all';
  return [...buckets.values()]
    .map((bucket) => ({
      model: bucket.model,
      ...finalizeTotals(bucket[periodKey]),
    }))
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
}

function summarizeModelBreakdown(entries, providerName) {
  const target = String(providerName || '').trim().toLowerCase();
  const buckets = new Map();
  const now = Date.now();
  const thresholds = {
    today: startOfUtcDay(now).getTime(),
    week: startOfUtcDay(now - (6 * DAY_MS)).getTime(),
    month: startOfUtcDay(now - (29 * DAY_MS)).getTime(),
  };

  for (const entry of entries) {
    if (target && String(entry.provider || '').trim().toLowerCase() !== target) {
      continue;
    }
    const model = String(entry.model || 'unknown').trim() || 'unknown';
    const bucket = buckets.get(model) || {
      model,
      today: createUsageSummary(),
      week: createUsageSummary(),
      month: createUsageSummary(),
      allTime: createUsageSummary(),
    };
    updateSummary(bucket.allTime, entry);
    const ts = parseTimestamp(entry.ts);
    if (ts !== null) {
      if (ts >= thresholds.today) {
        updateSummary(bucket.today, entry);
      }
      if (ts >= thresholds.week) {
        updateSummary(bucket.week, entry);
      }
      if (ts >= thresholds.month) {
        updateSummary(bucket.month, entry);
      }
    }
    buckets.set(model, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      model: bucket.model,
      today: finalizeTotals(bucket.today),
      week: finalizeTotals(bucket.week),
      month: finalizeTotals(bucket.month),
      allTime: finalizeTotals(bucket.allTime),
    }))
    .sort((a, b) => b.allTime.total - a.allTime.total || a.model.localeCompare(b.model));
}

export async function trackUsage(projectRoot, usageRecord = {}) {
  try {
    const root = normalizeRootPath(projectRoot);
    const budget = await getBudgetPolicy(root);
    if (budget.enabled === false) {
      return null;
    }
    const record = normalizeUsageRecord(usageRecord);
    record.costUsd = computeCostUsd(record, budget.pricing);
    await ensureDir(getBudgetRoot(root));
    await fs.appendFile(getTokenUsageFilePath(root), `${JSON.stringify(record)}\n`, 'utf8');
    budgetCacheMemo.delete(root);

    const eventPayload = {
      projectRoot: root,
      ...record,
    };
    emitter.emit('budget:usage', eventPayload);

    const limitCheck = await checkLimit(root, record.provider);
    if (limitCheck.exceeded.length) {
      emitter.emit('budget:limit_exceeded', {
        projectRoot: root,
        usage: record,
        exceeded: limitCheck.exceeded,
        warnings: limitCheck.warnings,
      });
    } else if (limitCheck.warnings.length) {
      emitter.emit('budget:limit_warning', {
        projectRoot: root,
        usage: record,
        warnings: limitCheck.warnings,
      });
    }
    return record;
  } catch {
    return null;
  }
}

export async function readCache(projectRoot) {
  const root = normalizeRootPath(projectRoot);
  const cachePath = getBudgetCachePath(root);
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function exportCSV(projectRoot, options = {}) {
  const root = normalizeRootPath(projectRoot);
  const entries = await listUsageEntries(root, {
    provider: options.provider || null,
    days: options.days || null,
    from: options.from || null,
    to: options.to || null,
  });
  const rows = [['ts', 'provider', 'model', 'promptTokens', 'completionTokens', 'totalTokens', 'costUsd', 'taskId', 'sessionId']];
  for (const entry of entries) {
    rows.push([
      entry.ts || '',
      entry.provider || '',
      entry.model || '',
      entry.promptTokens ?? '',
      entry.completionTokens ?? '',
      entry.totalTokens ?? '',
      entry.costUsd ?? '',
      entry.taskId || '',
      entry.sessionId || '',
    ]);
  }
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }).join(',')).join('\n');
}

export async function pruneUsage(projectRoot, keepDays = 90) {
  const root = normalizeRootPath(projectRoot);
  const threshold = Date.now() - (Math.max(0, Number(keepDays) || 0) * DAY_MS);
  const usagePath = getTokenUsageFilePath(root);
  const entries = await readUsageLines(usagePath);
  const kept = [];
  let removed = 0;
  for (const entry of entries) {
    const ts = parseTimestamp(entry.ts);
    if (ts !== null && ts < threshold) {
      removed += 1;
      continue;
    }
    kept.push(entry);
  }
  await ensureDir(getBudgetRoot(root));
  await fs.writeFile(usagePath, kept.length ? `${kept.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '', 'utf8');
  budgetCacheMemo.delete(root);
  return { removed, kept: kept.length };
}

export function createBudgetError(message, exceeded = []) {
  const error = new Error(message);
  error.code = 'BUDGET_EXCEEDED';
  error.exceeded = exceeded;
  return error;
}
