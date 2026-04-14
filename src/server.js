import crypto from 'node:crypto';
import { watch as watchFs } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { emitter } from './events.js';
import {
  ensureProjectMemory,
  getProjectMemoryStatus,
  listMemoryModuleSummaries,
  refreshProjectMemory,
  showMemoryEntry,
  summarizeCurrentMemory,
} from './memory.js';
import {
  ensureTaskWorkspace,
  listTasks,
  resolveTask,
  setCurrentTask,
  showTask,
  getCurrentTask,
} from './tasks.js';
import {
  appendMessage as appendConversationMessage,
  listConversationStats,
  listSessions as listConversationSessions,
  readHistory as readConversationHistory,
  readRecent as readRecentConversationMessages,
  readSession as readConversationSession,
} from './conversation.js';
import {
  getPendingPatch,
  getPatchStatus,
  applyPatchArtifact,
  rejectPatchArtifact,
  formatPatchDiff,
} from './patches.js';
import {
  detectRunner,
  getHistory as getTestRunHistory,
  readTestRunLog,
  runTests,
} from './test-runner.js';
import {
  getActiveProviderSelection,
  getContextWindowConfig,
  listProviderSummaries,
  useProvider,
} from './providers/index.js';
import {
  addWorkspace,
  listWorkspaces,
  refreshSnapshot as refreshWorkspaceSnapshot,
  switchWorkspace as switchProjectWorkspace,
} from './workspace.js';
import {
  listRoleProfiles,
  setActiveRole,
} from './roles.js';
import {
  getRunStatus,
  listRuns as listAutoRuns,
} from './auto-agent.js';
import {
  getStats,
  listEvents as listStatsEvents,
  refreshStats,
} from './stats.js';
import {
  getHookHistory,
  listHooks,
  setHookEnabled,
  testHook,
} from './hooks.js';
import {
  ensureProjectPolicy,
  readProjectPolicy,
  writeProjectPolicy,
} from './policy.js';
import { prepareProjectWorkspace } from './workspace-bootstrap.js';
import { listRegistryEntries, doctorRegistryCatalog } from './registry.js';

const PID_FILE_NAME = path.join('.local-codex', 'server.pid');
const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const MAX_JSON_BODY = 2 * 1024 * 1024;
const DEFAULT_SERVER_CONFIG = {
  port: 3000,
  host: '127.0.0.1',
  auth: {
    enabled: false,
    username: 'admin',
    passwordHash: '',
  },
  openOnStart: true,
  corsOrigins: [],
};

const serverRuns = new Map();

function normalizeRoot(root) {
  return path.resolve(String(root || process.cwd()));
}

function getPidPath(projectRoot) {
  return path.join(normalizeRoot(projectRoot), PID_FILE_NAME);
}

function nowIso() {
  return new Date().toISOString();
}

function safeText(value) {
  return String(value ?? '');
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

async function writePidFile(projectRoot, pid) {
  await fs.mkdir(path.dirname(getPidPath(projectRoot)), { recursive: true });
  await fs.writeFile(getPidPath(projectRoot), `${pid}\n`, 'utf8');
}

async function removePidFile(projectRoot) {
  await fs.rm(getPidPath(projectRoot), { force: true }).catch(() => {});
}

async function readPidFile(projectRoot) {
  const content = await readTextFile(getPidPath(projectRoot), '');
  const pid = Number.parseInt(String(content).trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function toPosix(value) {
  return String(value || '').replaceAll(path.sep, '/');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonResponse(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(`${body}\n`);
}

function textResponse(res, statusCode, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function withNoAuthHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
  };
}

function createServerError(message, statusCode = 500, code = 'server_error') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY) {
      throw createServerError('Request body too large.', 413, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

async function readPackageName(projectRoot) {
  const pkg = await readJsonFile(path.join(projectRoot, 'package.json'), null);
  return pkg?.name || path.basename(projectRoot);
}

function normalizeServerConfig(policy) {
  const server = policy?.server || {};
  return {
    ...DEFAULT_SERVER_CONFIG,
    ...server,
    auth: {
      ...DEFAULT_SERVER_CONFIG.auth,
      ...(server.auth || {}),
      enabled: server.auth?.enabled === true,
      username: typeof server.auth?.username === 'string' && server.auth.username.trim()
        ? server.auth.username.trim()
        : DEFAULT_SERVER_CONFIG.auth.username,
      passwordHash: typeof server.auth?.passwordHash === 'string'
        ? server.auth.passwordHash.trim()
        : DEFAULT_SERVER_CONFIG.auth.passwordHash,
    },
    port: Number.isFinite(Number(server.port)) && Number(server.port) > 0
      ? Math.floor(Number(server.port))
      : DEFAULT_SERVER_CONFIG.port,
    host: typeof server.host === 'string' && server.host.trim()
      ? server.host.trim()
      : DEFAULT_SERVER_CONFIG.host,
    openOnStart: server.openOnStart !== false,
    corsOrigins: Array.isArray(server.corsOrigins) ? server.corsOrigins.filter(Boolean) : [],
  };
}

async function readServerConfig(projectRoot) {
  const policy = await readProjectPolicy(projectRoot);
  return normalizeServerConfig(policy);
}

async function updateServerConfig(projectRoot, patch) {
  const policy = await readProjectPolicy(projectRoot);
  const next = {
    ...policy,
    server: {
      ...normalizeServerConfig(policy),
      ...(patch || {}),
      auth: {
        ...normalizeServerConfig(policy).auth,
        ...(patch?.auth || {}),
      },
    },
  };
  return writeProjectPolicy(projectRoot, next);
}

function getRuntime(projectRoot) {
  return serverRuns.get(normalizeRoot(projectRoot)) || null;
}

function setRuntime(projectRoot, runtime) {
  serverRuns.set(normalizeRoot(projectRoot), runtime);
}

function clearRuntime(projectRoot) {
  serverRuns.delete(normalizeRoot(projectRoot));
}

function authHeaderMessage() {
  return 'Basic realm="Workbench Dashboard", charset="UTF-8"';
}

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function canUseOrigin(config, origin) {
  if (!origin) {
    return true;
  }
  if (Array.isArray(config.corsOrigins) && config.corsOrigins.includes('*')) {
    return true;
  }
  return config.corsOrigins.includes(origin);
}

function applyCorsHeaders(req, res, config) {
  const origin = req.headers.origin || '';
  if (!origin) {
    return;
  }
  if (!canUseOrigin(config, origin)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isAuthenticated(req, config) {
  if (!config.auth?.enabled) {
    return true;
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(/\s+/, 2);
  if (scheme !== 'Basic' || !encoded) {
    return false;
  }
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return false;
  }
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const passwordHash = hashPassword(password);
  return username === config.auth.username && passwordHash === config.auth.passwordHash;
}

function sendAuthChallenge(res) {
  res.writeHead(401, {
    'WWW-Authenticate': authHeaderMessage(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify({ ok: false, error: 'auth_required' })}\n`);
}

function serializeTask(task) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    title: task.title,
    slug: task.slug,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    role: task.role || null,
    model: task.model || null,
    lastSessionId: task.lastSessionId || null,
    summary: task.summary || null,
    userRequest: task.userRequest || null,
    relevantFiles: Array.isArray(task.relevantFiles) ? [...task.relevantFiles] : [],
    lastRunNotes: Array.isArray(task.lastRunNotes) ? [...task.lastRunNotes] : [],
    location: task.location || null,
    folder: task.folder || null,
  };
}

function serializePatch(patch) {
  if (!patch) {
    return null;
  }
  return {
    patchId: patch.patchId || null,
    taskId: patch.taskId || null,
    status: patch.status || null,
    approvalMode: patch.approvalMode || null,
    approvalStatus: patch.approvalStatus || null,
    validationStatus: patch.validationStatus || null,
    summary: patch.summary || null,
    affectedFiles: Array.isArray(patch.affectedFiles) ? patch.affectedFiles.map((file) => ({
      path: file.path,
      action: file.action,
      approval: file.approval || null,
    })) : [],
    validationResults: Array.isArray(patch.validationResults) ? [...patch.validationResults] : [],
    diffText: patch.diffText || '',
    createdAt: patch.createdAt || null,
    updatedAt: patch.updatedAt || null,
    appliedAt: patch.appliedAt || null,
    rejectedAt: patch.rejectedAt || null,
    rolledBackAt: patch.rolledBackAt || null,
  };
}

function serializeTestRun(run) {
  if (!run) {
    return null;
  }
  return {
    runId: run.runId,
    command: run.command,
    status: run.status,
    exitCode: run.exitCode,
    duration: run.duration,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    patchId: run.patchId || null,
    taskId: run.taskId || null,
    runner: run.runner || null,
    summary: run.summary || null,
    failedTests: Array.isArray(run.failedTests) ? [...run.failedTests] : [],
    skipped: Boolean(run.skipped),
    reason: run.reason || null,
  };
}

function serializeRun(run) {
  if (!run) {
    return null;
  }
  return {
    runId: run.runId,
    taskId: run.taskId,
    request: run.request,
    provider: run.provider,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt || null,
    summary: run.summary || null,
    testCommand: run.testCommand || null,
    retryMax: run.retryMax,
    sessionId: run.sessionId || null,
    testOnEachStep: Boolean(run.testOnEachStep),
    abortOnTestFail: Boolean(run.abortOnTestFail),
    plan: Array.isArray(run.plan) ? run.plan.map((step) => ({
      stepId: step.stepId,
      title: step.title,
      description: step.description || '',
      files: Array.isArray(step.files) ? [...step.files] : [],
      status: step.status || null,
      patchId: step.patchId || null,
      testResult: step.testResult || null,
      attempts: step.attempts || 0,
      completedAt: step.completedAt || null,
      error: step.error || null,
    })) : [],
  };
}

function serializeRole(profile) {
  return {
    name: profile.name,
    description: profile.description,
    filePath: profile.filePath || null,
    builtin: Boolean(profile.builtin),
    fallback: Boolean(profile.fallback),
    invalid: Boolean(profile.invalid),
    sourceExtensionId: profile.sourceExtensionId || null,
  };
}

function serializeProviderSummary(entry) {
  return {
    name: entry.name,
    enabled: Boolean(entry.enabled),
    selected: Boolean(entry.selected),
    defaultModel: entry.defaultModel || null,
    baseUrl: entry.baseUrl || null,
    apiKeySet: Boolean(entry.apiKeySet),
    health: entry.health || null,
  };
}

function serializeWorkspace(workspace) {
  if (!workspace) {
    return null;
  }
  return {
    id: workspace.id,
    alias: workspace.alias,
    name: workspace.name,
    path: workspace.path,
    addedAt: workspace.addedAt || null,
    lastOpenedAt: workspace.lastOpenedAt || null,
    pinned: Boolean(workspace.pinned),
    tags: Array.isArray(workspace.tags) ? [...workspace.tags] : [],
    available: workspace.available !== false,
    current: Boolean(workspace.current),
    snapshot: {
      provider: workspace.snapshot?.provider || null,
      model: workspace.snapshot?.model || null,
      role: workspace.snapshot?.role || null,
      activeTask: workspace.snapshot?.activeTask || null,
      taskCount: Number.isFinite(workspace.snapshot?.taskCount) ? workspace.snapshot.taskCount : 0,
      taskCounts: workspace.snapshot?.taskCounts || {},
      lastRefreshedAt: workspace.snapshot?.lastRefreshedAt || null,
    },
  };
}

function serializeRegistryEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    type: entry.type,
    author: entry.author,
    description: entry.description,
    capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
    installNotes: entry.installNotes || '',
    source: entry.source || null,
    manifestPath: entry.manifestPath || null,
    publisher: entry.publisher || null,
    reviewStatus: entry.reviewStatus || null,
    verifiedSource: entry.verifiedSource ?? null,
    supportedAppVersions: Array.isArray(entry.supportedAppVersions) ? [...entry.supportedAppVersions] : [],
    signature: entry.signature || '',
    trustLevel: entry.trustLevel || null,
    recommended: Boolean(entry.recommended),
    registrySourceId: entry.registrySourceId || null,
    registrySourceLabel: entry.registrySourceLabel || null,
    registrySourceLocation: entry.registrySourceLocation || null,
    registrySourceEnabled: entry.registrySourceEnabled !== false,
  };
}

function classifyWorkspaceChange(filename) {
  const normalized = toPosix(filename);
  if (!normalized) {
    return null;
  }
  if (normalized.includes('.local-codex/tasks')) {
    if (normalized.endsWith('auto-run.json')) {
      return { event: 'auto:step', path: normalized };
    }
    return { event: 'task:updated', path: normalized };
  }
  if (
    normalized.endsWith('project_overview.md')
    || normalized.endsWith('architecture_notes.md')
    || normalized.endsWith('decisions_log.md')
    || normalized.endsWith('state.json')
    || normalized.endsWith('policy.json')
    || normalized.endsWith('providers.json')
  ) {
    return { event: 'project:refreshed', path: normalized };
  }
  if (normalized.includes('.local-codex/extensions')) {
    return { event: 'project:refreshed', path: normalized };
  }
  return null;
}

function getServerUrl(config) {
  return `http://${config.host}:${config.port}`;
}

function getDisplayHost(host) {
  return isLoopbackHost(host) ? host : '127.0.0.1';
}

async function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    resolve();
  });
}

function createRuntime(projectRoot, config) {
  const root = normalizeRoot(projectRoot);
  const clients = new Set();
  const watcherHandles = [];
  const send = (event, payload = {}) => {
    const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload, timestamp: nowIso() })}\n\n`;
    for (const res of clients) {
      try {
        res.write(message);
      } catch {
        clients.delete(res);
      }
    }
  };

  let heartbeat = null;
  const startHeartbeat = () => {
    heartbeat = setInterval(() => {
      for (const res of clients) {
        try {
          res.write(`: keepalive ${Date.now()}\n\n`);
        } catch {
          clients.delete(res);
        }
      }
    }, 25000);
    heartbeat.unref?.();
  };

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const handleWorkbenchEvent = (event) => {
    if (!event || (event.projectRoot && normalizeRoot(event.projectRoot) !== root)) {
      return;
    }
    send('workbench:event', event);
  };

  emitter.on('workbench:event', handleWorkbenchEvent);

  const watchPaths = [root];
  for (const watchPath of watchPaths) {
    try {
      const watcher = watchFs(watchPath, { recursive: true }, (_, filename) => {
        const classified = classifyWorkspaceChange(filename || '');
        if (classified) {
          send(classified.event, { path: classified.path });
        }
      });
      watcherHandles.push(watcher);
    } catch {
      // Ignore unsupported recursive watchers.
    }
  }

  const runtime = {
    root,
    config,
    clients,
    send,
    handleWorkbenchEvent,
    stopHeartbeat,
    watcherHandles,
    signalHandlers: [],
    shuttingDown: false,
  };
  startHeartbeat();
  return runtime;
}

async function closeRuntime(projectRoot) {
  const runtime = getRuntime(projectRoot);
  if (!runtime) {
    return;
  }
  runtime.stopHeartbeat?.();
  for (const watcher of runtime.watcherHandles || []) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  for (const [signal, handler] of runtime.signalHandlers || []) {
    try {
      process.off(signal, handler);
    } catch {
      // ignore
    }
  }
  for (const res of runtime.clients || []) {
    try {
      res.end();
    } catch {
      // ignore
    }
  }
  if (runtime.handleWorkbenchEvent) {
    try {
      emitter.off('workbench:event', runtime.handleWorkbenchEvent);
    } catch {
      // ignore
    }
  }
  clearRuntime(projectRoot);
  await removePidFile(projectRoot);
}

async function parsePatchHistory(projectRoot, limit = 20) {
  const root = normalizeRoot(projectRoot);
  const patchRoot = path.join(root, '.local-codex', 'patches');
  const entries = [];
  const dirs = await fs.readdir(patchRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of dirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const patchFile = path.join(patchRoot, entry.name, 'patch.json');
    const patch = await readJsonFile(patchFile, null);
    if (patch) {
      entries.push(serializePatch({
        ...patch,
        patchId: patch.patchId || entry.name,
      }));
    }
  }
  entries.sort((a, b) => String(b.updatedAt || b.appliedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.appliedAt || a.createdAt || '')));
  return entries.slice(0, Math.max(1, Number(limit) || 20));
}

async function getProjectStatusPayload(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const [state, providerSelection, task, pkgName] = await Promise.all([
    readJsonFile(path.join(root, '.local-codex', 'state.json'), null),
    getActiveProviderSelection(root).catch(() => null),
    getCurrentTask(root).catch(() => null),
    readPackageName(root).catch(() => path.basename(root)),
  ]);
  return {
    name: pkgName || path.basename(root),
    root,
    provider: providerSelection?.providerName || state?.selectedProvider || null,
    model: providerSelection?.model || state?.selectedModel || null,
    role: state?.activeRole || null,
    task: task ? serializeTask(task) : null,
    currentTaskId: state?.currentTaskId || null,
  };
}

async function getProjectMemoryPayload(projectRoot) {
  const [overview, architecture, decisions, summaries] = await Promise.all([
    showMemoryEntry(projectRoot, 'project_overview').catch(() => ''),
    showMemoryEntry(projectRoot, 'architecture_notes').catch(() => ''),
    showMemoryEntry(projectRoot, 'decisions_log').catch(() => ''),
    listMemoryModuleSummaries(projectRoot).catch(() => []),
  ]);
  return {
    overview,
    architecture,
    decisions,
    summaries,
  };
}

async function handleApiRequest(req, res, runtime, pathname, searchParams) {
  const projectRoot = runtime.root;
  const policy = runtime.policy;

  if (!isAuthenticated(req, runtime.config)) {
    sendAuthChallenge(res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, withNoAuthHeaders({
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }));
    res.end();
    return;
  }

  applyCorsHeaders(req, res, runtime.config);

  if (pathname === '/api/v1/project/status' && req.method === 'GET') {
    const payload = await getProjectStatusPayload(projectRoot);
    jsonResponse(res, 200, payload);
    return;
  }

  if (pathname === '/api/v1/project/memory' && req.method === 'GET') {
    jsonResponse(res, 200, await getProjectMemoryPayload(projectRoot));
    return;
  }

  if (pathname === '/api/v1/project/refresh' && req.method === 'POST') {
    const result = await refreshProjectMemory(projectRoot);
    runtime.send('project:refreshed', { root: projectRoot });
    jsonResponse(res, 200, { ok: true, result });
    return;
  }

  if (pathname === '/api/v1/tasks' && req.method === 'GET') {
    const tasks = await listTasks(projectRoot);
    jsonResponse(res, 200, {
      currentTaskId: tasks.currentTaskId,
      tasks: tasks.tasks.map(serializeTask),
    });
    return;
  }

  if (pathname.startsWith('/api/v1/tasks/') && req.method === 'GET') {
    const segments = pathname.split('/').filter(Boolean);
    const taskId = decodeURIComponent(segments[3] || '');
    const action = segments[4] || '';
    if (!taskId) {
      jsonResponse(res, 404, { ok: false, error: 'missing_task_id' });
      return;
    }
    if (!action) {
      const task = await resolveTask(projectRoot, taskId);
      if (!task) {
        jsonResponse(res, 404, { ok: false, error: 'task_not_found' });
        return;
      }
      jsonResponse(res, 200, { task: serializeTask(task) });
      return;
    }
    if (action === 'history') {
      const limit = Number(searchParams.get('limit') || 20);
      const sessionId = searchParams.get('session') || '';
      const task = await resolveTask(projectRoot, taskId);
      if (!task) {
        jsonResponse(res, 404, { ok: false, error: 'task_not_found' });
        return;
      }
      const taskDir = path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
      const messages = sessionId
        ? await readConversationSession(taskDir, sessionId)
        : await readRecentConversationMessages(taskDir, limit);
      jsonResponse(res, 200, { messages });
      return;
    }
    if (action === 'runs') {
      jsonResponse(res, 200, { runs: (await listAutoRuns(taskId, { projectRoot })).map(serializeRun) });
      return;
    }
    if (action === 'plan') {
      const task = await showTask(projectRoot, taskId);
      jsonResponse(res, 200, { content: task.planMarkdown || '' });
      return;
    }
  }

  if (pathname.startsWith('/api/v1/tasks/') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const taskId = decodeURIComponent(segments[3] || '');
    const action = segments[4] || '';
    if (!taskId) {
      jsonResponse(res, 404, { ok: false, error: 'missing_task_id' });
      return;
    }
    if (action === 'use') {
      const task = await setCurrentTask(projectRoot, taskId);
      runtime.send('task:updated', { taskId: task.id });
      jsonResponse(res, 200, { ok: true, task: serializeTask(task) });
      return;
    }
  }

  if (pathname === '/api/v1/patches/pending' && req.method === 'GET') {
    const pending = await getPendingPatch(projectRoot);
    jsonResponse(res, 200, pending ? serializePatch(pending) : null);
    return;
  }

  if (pathname === '/api/v1/patches/history' && req.method === 'GET') {
    const history = await parsePatchHistory(projectRoot, Number(searchParams.get('limit') || 20));
    jsonResponse(res, 200, { patches: history });
    return;
  }

  if (pathname === '/api/v1/patches/apply' && req.method === 'POST') {
    const body = await readJsonBody(req).catch((error) => {
      throw createServerError(error.message, 400, 'invalid_json');
    });
    const result = await applyPatchArtifact(projectRoot, null, {
      policy,
      promptApproval: body.promptApproval,
    });
    jsonResponse(res, 200, { ok: result.applied, testResult: result.testOutcome || null, patch: serializePatch(result.patch) });
    return;
  }

  if (pathname === '/api/v1/patches/reject' && req.method === 'POST') {
    const result = await rejectPatchArtifact(projectRoot, null);
    jsonResponse(res, 200, { ok: result.rejected, patch: serializePatch(result.patch) });
    return;
  }

  if (pathname === '/api/v1/stats' && req.method === 'GET') {
    const stats = await getStats(projectRoot);
    jsonResponse(res, 200, stats);
    return;
  }

  if (pathname === '/api/v1/stats/refresh' && req.method === 'POST') {
    const stats = await refreshStats(projectRoot);
    runtime.send('stats:updated', { generatedAt: stats.generatedAt });
    jsonResponse(res, 200, stats);
    return;
  }

  if (pathname === '/api/v1/stats/events' && req.method === 'GET') {
    const events = await listStatsEvents(projectRoot, {
      limit: Number(searchParams.get('limit') || 100),
      type: searchParams.get('type') || null,
      reverse: true,
    });
    jsonResponse(res, 200, { events });
    return;
  }

  if (pathname === '/api/v1/tests/history' && req.method === 'GET') {
    const history = await getTestRunHistory(projectRoot, {
      limit: Number(searchParams.get('limit') || 20),
      status: searchParams.get('status') || null,
    });
    jsonResponse(res, 200, { runs: history.map(serializeTestRun) });
    return;
  }

  if (pathname.startsWith('/api/v1/tests/') && pathname.endsWith('/log') && req.method === 'GET') {
    const segments = pathname.split('/').filter(Boolean);
    const runId = decodeURIComponent(segments[3] || '');
    const output = await readTestRunLog(projectRoot, runId).catch(() => '');
    jsonResponse(res, 200, { output });
    return;
  }

  if (pathname === '/api/v1/tests/run' && req.method === 'POST') {
    const body = await readJsonBody(req).catch((error) => {
      throw createServerError(error.message, 400, 'invalid_json');
    });
    const result = await runTests({
      projectRoot,
      policy,
      command: body.command || null,
      cwd: body.cwd || null,
      timeout: body.timeout || undefined,
      env: body.env || {},
      patchId: body.patchId || null,
      taskId: body.taskId || null,
      allowApprovalBypass: true,
    });
    jsonResponse(res, 200, { run: serializeTestRun(result) });
    return;
  }

  if (pathname === '/api/v1/providers' && req.method === 'GET') {
    const summaries = await listProviderSummaries(projectRoot);
    jsonResponse(res, 200, {
      defaultProvider: summaries.defaultProvider,
      providers: summaries.providers.map(serializeProviderSummary),
    });
    return;
  }

  if (pathname === '/api/v1/providers/health' && req.method === 'GET') {
    const summaries = await listProviderSummaries(projectRoot);
    jsonResponse(res, 200, {
      results: summaries.providers.map((provider) => ({
        name: provider.name,
        ok: provider.health?.ok || false,
        message: provider.health?.message || '',
        enabled: provider.enabled,
      })),
    });
    return;
  }

  if (pathname === '/api/v1/workspaces' && req.method === 'GET') {
    const workspaces = await listWorkspaces();
    jsonResponse(res, 200, {
      workspaces: workspaces.map(serializeWorkspace),
    });
    return;
  }

  if (pathname === '/api/v1/workspaces/refresh' && req.method === 'POST') {
    const workspaces = await listWorkspaces();
    const refreshed = [];
    for (const workspace of workspaces) {
      refreshed.push(await refreshWorkspaceSnapshot(workspace.alias));
    }
    runtime.send('workspace:updated', { count: refreshed.length });
    jsonResponse(res, 200, { ok: true, count: refreshed.length, workspaces: refreshed.map(serializeWorkspace) });
    return;
  }

  if (pathname.startsWith('/api/v1/workspaces/') && pathname.endsWith('/switch') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const workspaceId = decodeURIComponent(segments[3] || '');
    if (!workspaceId) {
      jsonResponse(res, 404, { ok: false, error: 'missing_workspace_id' });
      return;
    }
    const workspace = await switchProjectWorkspace(workspaceId);
    runtime.send('workspace:updated', { workspaceId: workspace.id, alias: workspace.alias });
    jsonResponse(res, 200, { ok: true, workspace: serializeWorkspace(workspace) });
    return;
  }

  if (pathname === '/api/v1/registry' && req.method === 'GET') {
    const entries = await listRegistryEntries(projectRoot);
    jsonResponse(res, 200, {
      entries: entries.map(serializeRegistryEntry),
    });
    return;
  }

  if (pathname === '/api/v1/registry/doctor' && req.method === 'GET') {
    jsonResponse(res, 200, await doctorRegistryCatalog(projectRoot));
    return;
  }

  if (pathname.startsWith('/api/v1/providers/') && pathname.endsWith('/use') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const providerName = decodeURIComponent(segments[3] || '');
    const provider = await useProvider(projectRoot, providerName);
    runtime.send('project:refreshed', { provider: provider.name });
    jsonResponse(res, 200, {
      ok: true,
      provider: provider.name,
      model: provider.defaultModel,
    });
    return;
  }

  if (pathname === '/api/v1/roles' && req.method === 'GET') {
    const roles = await listRoleProfiles(projectRoot);
    jsonResponse(res, 200, {
      roles: roles.map(serializeRole),
    });
    return;
  }

  if (pathname.startsWith('/api/v1/roles/') && pathname.endsWith('/use') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const roleName = decodeURIComponent(segments[3] || '');
    const role = await setActiveRole(projectRoot, roleName);
    jsonResponse(res, 200, { ok: true, role: serializeRole(role) });
    return;
  }

  if (pathname === '/api/v1/hooks' && req.method === 'GET') {
    jsonResponse(res, 200, { hooks: await listHooks(projectRoot) });
    return;
  }

  if (pathname.startsWith('/api/v1/hooks/') && pathname.endsWith('/test') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const hookId = decodeURIComponent(segments[3] || '');
    jsonResponse(res, 200, { results: await testHook(projectRoot, hookId) });
    return;
  }

  if (pathname.startsWith('/api/v1/hooks/') && pathname.endsWith('/enable') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const hookId = decodeURIComponent(segments[3] || '');
    const hook = await setHookEnabled(projectRoot, hookId, true);
    jsonResponse(res, 200, { ok: true, hook });
    return;
  }

  if (pathname.startsWith('/api/v1/hooks/') && pathname.endsWith('/disable') && req.method === 'POST') {
    const segments = pathname.split('/').filter(Boolean);
    const hookId = decodeURIComponent(segments[3] || '');
    const hook = await setHookEnabled(projectRoot, hookId, false);
    jsonResponse(res, 200, { ok: true, hook });
    return;
  }

  if (pathname === '/api/v1/hooks/history' && req.method === 'GET') {
    const history = await getHookHistory(projectRoot, {
      limit: Number(searchParams.get('limit') || 20),
    });
    jsonResponse(res, 200, { history });
    return;
  }

  if (pathname === '/api/v1/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...withNoAuthHeaders(),
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: nowIso() })}\n\n`);
    runtime.clients.add(res);
    req.on('close', () => runtime.clients.delete(res));
    return;
  }

  if (pathname === '/api/v1/project/current-task' && req.method === 'GET') {
    const task = await getCurrentTask(projectRoot);
    jsonResponse(res, 200, { task: task ? serializeTask(task) : null });
    return;
  }

  if (pathname === '/api/v1/memory/status' && req.method === 'GET') {
    jsonResponse(res, 200, await getProjectMemoryStatus(projectRoot));
    return;
  }

  if (pathname === '/api/v1/conversation/stats' && req.method === 'GET') {
    const task = await getCurrentTask(projectRoot);
    if (!task) {
      jsonResponse(res, 200, { messageCount: 0, sessionCount: 0, providers: [], recentMessages: [], sessions: [] });
      return;
    }
    const taskDir = path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
    jsonResponse(res, 200, await listConversationStats(taskDir));
    return;
  }

  jsonResponse(res, 404, { ok: false, error: 'not_found', path: pathname });
}

async function serveStaticFile(res, fileName, contentType) {
  const filePath = path.join(STATIC_DIR, fileName);
  const content = await readTextFile(filePath, null);
  if (content === null) {
    throw createServerError(`Static asset not found: ${fileName}`, 404, 'not_found');
  }
  textResponse(res, 200, content, contentType);
}

async function handleRequest(req, res, runtime) {
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname, searchParams } = url;

  try {
    if (pathname.startsWith('/api/v1/')) {
      await handleApiRequest(req, res, runtime, pathname, searchParams);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      await serveStaticFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }

    if (pathname === '/style.css') {
      await serveStaticFile(res, 'style.css', 'text/css; charset=utf-8');
      return;
    }

    if (pathname === '/app.js') {
      await serveStaticFile(res, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SPA fallback for client-side routes.
    await serveStaticFile(res, 'index.html', 'text/html; charset=utf-8');
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    jsonResponse(res, statusCode, {
      ok: false,
      error: error?.code || 'server_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupProject(projectRoot) {
  await removePidFile(projectRoot);
  const runtime = getRuntime(projectRoot);
  if (runtime) {
    runtime.stopHeartbeat?.();
    for (const watcher of runtime.watcherHandles || []) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    for (const res of runtime.clients || []) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    clearRuntime(projectRoot);
  }
}

export async function startServer(projectRoot, options = {}) {
  const root = normalizeRoot(projectRoot || process.cwd());
  await prepareProjectWorkspace(root, { scaffoldRoles: false });
  await ensureTaskWorkspace(root);
  await ensureProjectPolicy(root);
  await addWorkspace(root).catch(() => {});

  const policy = await readProjectPolicy(root);
  const config = normalizeServerConfig(policy);
  const host = options.host || config.host;
  const port = Number.isFinite(Number(options.port)) && Number(options.port) >= 0
    ? Math.floor(Number(options.port))
    : config.port;
  const openRequested = options.open === true || (options.open === undefined && config.openOnStart);
  const runtime = createRuntime(root, config);

  const server = http.createServer((req, res) => {
    runtime.policy = runtime.policy || policy;
    handleRequest(req, res, runtime);
  });

  server.on('close', async () => {
    await cleanupProject(root);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const addressInfo = server.address();
  const resolvedPort = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : port;
  const resolvedHost = typeof addressInfo === 'object' && addressInfo ? addressInfo.address : host;
  const displayHost = resolvedHost === '::' || resolvedHost === '0.0.0.0'
    ? '127.0.0.1'
    : resolvedHost;
  const url = `http://${displayHost}:${resolvedPort}`;

  await writePidFile(root, process.pid);
  setRuntime(root, {
    ...runtime,
    server,
    url,
    config: { ...config, host: resolvedHost, port: resolvedPort },
    policy,
  });

  const activeRuntime = getRuntime(root);
  if (activeRuntime) {
    const handleShutdownSignal = () => {
      if (activeRuntime.shuttingDown) {
        return;
      }
      activeRuntime.shuttingDown = true;
      server.close(() => {
        void cleanupProject(root);
      });
    };
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, handleShutdownSignal);
      activeRuntime.signalHandlers.push([signal, handleShutdownSignal]);
    }
  }

  if (openRequested) {
    await openBrowser(url);
  }

  return {
    server,
    url,
    config: { ...config, host: resolvedHost, port: resolvedPort },
    root,
    opened: openRequested,
  };
}

export async function stopServer(projectRoot) {
  const root = normalizeRoot(projectRoot || process.cwd());
  const pid = await readPidFile(root);
  if (!pid) {
    return { stopped: false, reason: 'not_running' };
  }

  const running = await new Promise((resolve) => {
    try {
      process.kill(pid, 0);
      resolve(true);
    } catch {
      resolve(false);
    }
  });

  await removePidFile(root);
  const runtime = getRuntime(root);
  if (runtime?.server) {
    await new Promise((resolve) => runtime.server.close(resolve)).catch(() => {});
  }

  if (running) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }

  return { stopped: running, pid };
}

export async function getServerStatus(projectRoot) {
  const root = normalizeRoot(projectRoot || process.cwd());
  const pid = await readPidFile(root);
  if (!pid) {
    return {
      running: false,
      pid: null,
      url: null,
    };
  }
  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    running = false;
  }
  const policy = await readProjectPolicy(root);
  const config = normalizeServerConfig(policy);
  return {
    running,
    pid,
    url: running ? `http://${getDisplayHost(config.host)}:${config.port}` : null,
  };
}

export async function getServerConfig(projectRoot) {
  return readServerConfig(projectRoot);
}

export async function setServerConfig(projectRoot, patch) {
  return updateServerConfig(projectRoot, patch);
}

export function getServerPidPath(projectRoot) {
  return getPidPath(projectRoot);
}
