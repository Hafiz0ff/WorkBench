import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { emitter } from './events.js';
import { normalizeRoot } from './security.js';
import { readProjectPolicy, writeProjectPolicy } from './policy.js';

const WORKBENCH_DIR_NAME = '.workbench';
const SECRETS_FILE_NAME = 'secrets.json';
const HOOK_HISTORY_FILE_NAME = 'hook-history.jsonl';
const HOOK_ERRORS_FILE_NAME = 'hook-errors.log';
const HOOK_HISTORY_LIMIT = 500;

const hookListeners = new Map();

function getWorkbenchHome() {
  return path.resolve(process.env.WORKBENCH_HOME || path.join(os.homedir(), WORKBENCH_DIR_NAME));
}

function getSecretsPath() {
  return path.join(getWorkbenchHome(), SECRETS_FILE_NAME);
}

function getProjectRoot(root) {
  return normalizeRoot(root || process.cwd());
}

function getHistoryPath(projectRoot) {
  return path.join(getProjectRoot(projectRoot), '.local-codex', HOOK_HISTORY_FILE_NAME);
}

function getErrorsPath(projectRoot) {
  return path.join(getProjectRoot(projectRoot), '.local-codex', HOOK_ERRORS_FILE_NAME);
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

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJsonLines(filePath) {
  if (!(await fileExists(filePath))) {
    return [];
  }
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
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

async function readSecrets() {
  return readJsonFile(getSecretsPath(), {});
}

async function writeSecrets(next) {
  await ensureDir(getWorkbenchHome());
  await fs.writeFile(getSecretsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function deepGet(object, keyPath) {
  return String(keyPath).split('.').reduce((value, segment) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, segment)) {
      return value[segment];
    }
    return undefined;
  }, object);
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) {
    return '0с';
  }
  if (value < 1000) {
    return `${value}мс`;
  }
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}м ${seconds}с`;
  }
  return `${seconds}с`;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderTemplate(template, event) {
  const source = String(template || '');
  return source.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_, key) => {
    const value = deepGet(event, key);
    return formatValue(value);
  });
}

function normalizeRule(rule = {}) {
  const on = Array.isArray(rule.on) ? rule.on.map((value) => String(value || '').trim()).filter(Boolean) : [];
  return {
    id: String(rule.id || '').trim(),
    name: String(rule.name || rule.id || '').trim(),
    enabled: rule.enabled !== false,
    on,
    channel: String(rule.channel || '').trim().toLowerCase(),
    message: typeof rule.message === 'string' ? rule.message : '',
    command: typeof rule.command === 'string' ? rule.command : '',
    args: Array.isArray(rule.args) ? rule.args.map((value) => String(value)) : [],
    url: typeof rule.url === 'string' ? rule.url : '',
    method: typeof rule.method === 'string' ? rule.method.toUpperCase() : 'POST',
    headers: rule.headers && typeof rule.headers === 'object' ? { ...rule.headers } : {},
    body: typeof rule.body === 'string' ? rule.body : '',
    conditions: rule.conditions && typeof rule.conditions === 'object' ? { ...rule.conditions } : {},
  };
}

function formatRuleSummary(rule) {
  const events = rule.on.join(', ');
  const conditionParts = [];
  if (rule.conditions?.status) conditionParts.push(`status=${rule.conditions.status}`);
  if (rule.conditions?.provider) conditionParts.push(`provider=${rule.conditions.provider}`);
  if (Number.isFinite(Number(rule.conditions?.minDuration))) {
    conditionParts.push(`minDuration=${Math.floor(Number(rule.conditions.minDuration))}`);
  }
  return {
    id: rule.id,
    name: rule.name,
    enabled: Boolean(rule.enabled),
    channel: rule.channel,
    on: rule.on,
    summary: events,
    conditions: conditionParts.join(', '),
    message: rule.message || '',
  };
}

function normalizeHooksConfig(policy = {}) {
  const hooks = policy.hooks || {};
  return {
    enabled: hooks.enabled !== false,
    telegram: {
      botToken: typeof hooks.telegram?.botToken === 'string' ? hooks.telegram.botToken.trim() : '',
      chatId: typeof hooks.telegram?.chatId === 'string' ? hooks.telegram.chatId.trim() : '',
    },
    rules: Array.isArray(hooks.rules) ? hooks.rules.map(normalizeRule) : [],
  };
}

function validateHook(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') {
    errors.push('hook is required');
  } else {
    if (!rule.id) errors.push('missing id');
    if (!rule.channel) errors.push('missing channel');
    if (!Array.isArray(rule.on) || !rule.on.length) errors.push('missing on');
    if (rule.channel === 'telegram' && !rule.message) errors.push('missing message');
    if (rule.channel === 'shell' && !rule.command) errors.push('missing command');
    if (rule.channel === 'webhook' && !rule.url) errors.push('missing url');
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

function matchConditions(rule, event) {
  const conditions = rule.conditions || {};
  if (conditions.status && String(event.status || '') !== String(conditions.status)) {
    return false;
  }
  if (conditions.provider && String(event.provider || '') !== String(conditions.provider)) {
    return false;
  }
  if (Number.isFinite(Number(conditions.minDuration)) && Number(event.duration) < Number(conditions.minDuration)) {
    return false;
  }
  return true;
}

async function appendHookHistory(projectRoot, record) {
  const historyPath = getHistoryPath(projectRoot);
  await appendJsonLine(historyPath, record);
  const entries = await readJsonLines(historyPath);
  if (entries.length > HOOK_HISTORY_LIMIT) {
    await writeJsonLines(historyPath, entries.slice(-HOOK_HISTORY_LIMIT));
  }
}

async function appendHookError(projectRoot, message) {
  const errorsPath = getErrorsPath(projectRoot);
  await ensureDir(path.dirname(errorsPath));
  await fs.appendFile(errorsPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8').catch(() => {});
}

async function resolveSecretValue(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('@secret:')) {
    return ref;
  }
  const key = ref.slice('@secret:'.length).trim();
  if (!key) {
    return '';
  }
  const secrets = await readSecrets();
  return typeof secrets[key] === 'string' ? secrets[key] : '';
}

async function runShellHook(rule, event, { spawnImpl = spawn } = {}) {
  const command = renderTemplate(rule.command, event);
  const args = Array.isArray(rule.args) ? rule.args.map((value) => renderTemplate(value, event)) : [];
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      cwd: getProjectRoot(event.projectRoot),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(rule.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        error: error.message,
      });
    });
  });
}

async function sendTelegram(rule, event, { fetchImpl = globalThis.fetch, retryDelayMs = 3000 } = {}) {
  const botToken = await resolveSecretValue(rule.telegram?.botToken || rule.botToken || '');
  const chatId = rule.telegram?.chatId || rule.chatId || '';
  const message = renderTemplate(rule.message, event);
  if (!botToken) {
    return { ok: false, status: 400, error: 'missing bot token' };
  }
  if (!chatId) {
    return { ok: false, status: 400, error: 'missing chat id' };
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };

  const attempt = async () => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: text,
      };
    }
    return {
      ok: true,
      status: response.status,
      body: text,
    };
  };

  try {
    const first = await attempt();
    if (first.ok) {
      return first;
    }
    if (first.status >= 500 || first.status === 0) {
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      return attempt();
    }
    return first;
  } catch (error) {
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    try {
      return await attempt();
    } catch (retryError) {
      return {
        ok: false,
        status: 0,
        error: retryError.message || error.message,
      };
    }
  }
}

async function sendWebhook(rule, event, { fetchImpl = globalThis.fetch } = {}) {
  const url = renderTemplate(rule.url, event);
  const method = (rule.method || 'POST').toUpperCase();
  const headers = {};
  for (const [key, value] of Object.entries(rule.headers || {})) {
    headers[key] = renderTemplate(value, event);
  }
  const body = rule.body ? renderTemplate(rule.body, event) : null;
  const response = await fetchImpl(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : (body || JSON.stringify(event)),
  });
  const responseBody = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
}

async function recordDispatch(projectRoot, hook, event, result) {
  await appendHookHistory(projectRoot, {
    ts: new Date().toISOString(),
    hookId: hook.id,
    event: event.type,
    channel: hook.channel,
    status: result?.ok ? 'sent' : 'failed',
    durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : null,
    error: result?.error || result?.body || null,
  });
  if (result && !result.ok) {
    await appendHookError(projectRoot, `${hook.id}: ${result.error || result.body || 'dispatch failed'}`);
  }
}

async function dispatchHook(rule, event) {
  const startedAt = Date.now();
  try {
    let result;
    if (rule.channel === 'telegram') {
      result = await sendTelegram(rule, event);
    } else if (rule.channel === 'shell') {
      result = await runShellHook(rule, event);
    } else if (rule.channel === 'webhook') {
      result = await sendWebhook(rule, event);
    } else {
      result = { ok: false, error: `unsupported channel: ${rule.channel}` };
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function getHookHistory(projectRoot, options = {}) {
  const entries = await readJsonLines(getHistoryPath(projectRoot));
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.floor(Number(options.limit))
    : entries.length;
  const reversed = [...entries].reverse();
  return reversed.slice(0, limit);
}

export async function listHooks(projectRoot) {
  const policy = await readProjectPolicy(getProjectRoot(projectRoot));
  const hooks = normalizeHooksConfig(policy);
  return hooks.rules.map((rule) => ({
    ...formatRuleSummary(rule),
    telegramConfigured: Boolean(hooks.telegram.botToken && hooks.telegram.chatId),
    hasSecretToken: Boolean(String(hooks.telegram.botToken || '').startsWith('@secret:')),
  }));
}

export async function initHooks(projectRoot) {
  const root = getProjectRoot(projectRoot);
  if (hookListeners.has(root)) {
    return;
  }
  const listener = (event) => {
    if (!event || event.projectRoot && normalizeRoot(event.projectRoot) !== root) {
      return;
    }
    void dispatch(event).catch(() => {});
  };
  emitter.on('workbench:event', listener);
  hookListeners.set(root, listener);
}

export async function dispatch(event) {
  const projectRoot = getProjectRoot(event?.projectRoot || process.cwd());
  const policy = normalizeHooksConfig(await readProjectPolicy(projectRoot));
  if (!policy.enabled) {
    return [];
  }
  const results = [];
  for (const rawRule of policy.rules) {
    const rule = normalizeRule(rawRule);
    if (!rule.enabled) continue;
    const validation = validateHook(rule);
    if (!validation.ok) continue;
    if (!rule.on.includes(event.type)) continue;
    if (!matchConditions(rule, event)) continue;
    const result = await dispatchHook({ ...rule, telegram: policy.telegram }, { ...event, projectRoot });
    await recordDispatch(projectRoot, rule, event, result);
    results.push({
      hookId: rule.id,
      channel: rule.channel,
      status: result.ok ? 'sent' : 'failed',
      durationMs: result.durationMs || 0,
      error: result.error || null,
    });
  }
  return results;
}

export async function testHook(projectRoot, hookId) {
  const hooks = await listHooks(projectRoot);
  const hook = hooks.find((entry) => entry.id === hookId);
  if (!hook) {
    throw new Error(`Hook not found: ${hookId}`);
  }
  const policy = normalizeHooksConfig(await readProjectPolicy(projectRoot));
  const rule = policy.rules.find((entry) => String(entry.id || '').trim() === hookId);
  if (!rule) {
    throw new Error(`Hook not found: ${hookId}`);
  }
  const syntheticEvent = {
    type: rule.on[0] || 'workbench.event',
    ts: new Date().toISOString(),
    projectRoot: getProjectRoot(projectRoot),
    taskId: 'task-test',
    taskTitle: 'Тестовый запуск',
    patchId: 'patch-test',
    provider: 'openai',
    model: 'gpt-4o',
    stepsCount: 1,
    duration: 1234,
    status: rule.conditions?.status || 'failed',
    command: 'npm test',
    summary: { total: 1, passed: 0, failed: 1 },
    reason: 'test',
    projectName: 'Workbench',
  };
  const startedAt = Date.now();
  const result = await dispatchHook({ ...normalizeRule(rule), telegram: policy.telegram }, syntheticEvent);
  await recordDispatch(getProjectRoot(projectRoot), normalizeRule(rule), syntheticEvent, result);
  return [{
    hookId: String(rule.id || hookId),
    channel: normalizeRule(rule).channel,
    status: result.ok ? 'sent' : 'failed',
    durationMs: Date.now() - startedAt,
    error: result.error || null,
  }];
}

export async function setHookEnabled(projectRoot, hookId, enabled) {
  const root = getProjectRoot(projectRoot);
  const policy = await readProjectPolicy(root);
  const hooks = normalizeHooksConfig(policy);
  const nextRules = hooks.rules.map((rule) => (String(rule.id) === String(hookId) ? { ...rule, enabled } : rule));
  const nextEnabled = enabled || nextRules.some((rule) => rule.enabled);
  const next = {
    ...policy,
    hooks: {
      ...hooks,
      enabled: nextEnabled,
      rules: nextRules,
    },
  };
  await writeProjectPolicy(root, next);
  return nextRules.find((rule) => String(rule.id) === String(hookId)) || null;
}

export async function setupTelegramHook(projectRoot, { botToken, chatId, enable = true } = {}) {
  const root = getProjectRoot(projectRoot);
  await ensureDir(getWorkbenchHome());
  const secrets = await readSecrets();
  if (botToken) {
    secrets.telegram_bot_token = botToken;
    await writeSecrets(secrets);
  }
  const policy = await readProjectPolicy(root);
  const hooks = normalizeHooksConfig(policy);
  const updatedRules = hooks.rules.map((rule) => (rule.channel === 'telegram' ? { ...rule, enabled: enable ? true : rule.enabled } : rule));
  const next = {
    ...policy,
    hooks: {
      ...hooks,
      enabled: true,
      telegram: {
        botToken: '@secret:telegram_bot_token',
        chatId: chatId || hooks.telegram.chatId,
      },
      rules: updatedRules,
    },
  };
  await writeProjectPolicy(root, next);
  return next.hooks;
}

export async function addHook(projectRoot, hook) {
  const root = getProjectRoot(projectRoot);
  const policy = await readProjectPolicy(root);
  const hooks = normalizeHooksConfig(policy);
  const nextRule = normalizeRule(hook);
  const next = {
    ...policy,
    hooks: {
      ...hooks,
      enabled: true,
      rules: [...hooks.rules, nextRule],
    },
  };
  await writeProjectPolicy(root, next);
  return nextRule;
}

export { normalizeHooksConfig, validateHook, renderTemplate as formatMessage, runShellHook, sendTelegram, sendWebhook };
