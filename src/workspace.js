import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeRoot } from './security.js';
import { listTasks, getCurrentTask } from './tasks.js';
import { readProjectState, updateProjectState } from './memory.js';

const WORKBENCH_DIR_NAME = '.workbench';
const WORKSPACES_FILE_NAME = 'workspaces.json';
const CONFIG_FILE_NAME = 'config.json';
const LOGS_DIR_NAME = 'logs';
const WORKBENCH_SCHEMA_VERSION = 1;
const DEFAULT_CONFIG = {
  version: WORKBENCH_SCHEMA_VERSION,
  defaultProvider: 'ollama',
  defaultModel: 'qwen2.5-coder:14b',
  autoRefreshOnSwitch: true,
  listSort: 'lastOpened',
  dateLocale: 'ru',
};
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-_]{0,49}$/;
const DEFAULT_SCAN_DEPTH = 4;
const DEFAULT_SCAN_LIMIT = 4000;

function nowIso() {
  return new Date().toISOString();
}

function getWorkbenchHome() {
  return path.resolve(process.env.WORKBENCH_HOME || path.join(os.homedir(), WORKBENCH_DIR_NAME));
}

export function getWorkspaceRegistryPath() {
  return path.join(getWorkbenchHome(), WORKSPACES_FILE_NAME);
}

export function getWorkspaceConfigPath() {
  return path.join(getWorkbenchHome(), CONFIG_FILE_NAME);
}

function getWorkspaceLogsPath() {
  return path.join(getWorkbenchHome(), LOGS_DIR_NAME);
}

function normalizeProjectPath(projectPath) {
  const root = normalizeRoot(projectPath);
  return root;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    const wrapped = new Error(`Failed to read JSON file: ${filePath}`);
    wrapped.code = 'WORKSPACE_REGISTRY_CORRUPTED';
    wrapped.cause = error;
    throw wrapped;
  }
}

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function slugifyAlias(value) {
  const base = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 50) || 'workbench';
}

function validateAlias(alias) {
  const normalized = slugifyAlias(alias);
  if (!ALIAS_PATTERN.test(normalized)) {
    const error = new Error(`Invalid workspace alias: ${alias}`);
    error.code = 'WORKSPACE_INVALID_ALIAS';
    error.alias = alias;
    throw error;
  }
  return normalized;
}

function uniqueTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function ensureDirectoryStructure() {
  await fs.mkdir(getWorkbenchHome(), { recursive: true });
  await fs.mkdir(getWorkspaceLogsPath(), { recursive: true });
}

async function ensureRegistryFile() {
  const registryPath = getWorkspaceRegistryPath();
  if (!(await fileExists(registryPath))) {
    await atomicWriteJson(registryPath, {
      version: WORKBENCH_SCHEMA_VERSION,
      lastUsed: null,
      workspaces: [],
    });
  }
}

async function ensureConfigFile() {
  const configPath = getWorkspaceConfigPath();
  if (!(await fileExists(configPath))) {
    await atomicWriteJson(configPath, DEFAULT_CONFIG);
  }
}

export async function initGlobal() {
  await ensureDirectoryStructure();
  await ensureRegistryFile();
  await ensureConfigFile();
}

async function readRegistry() {
  await initGlobal();
  const registry = await readJson(getWorkspaceRegistryPath(), null);
  if (!registry) {
    return {
      version: WORKBENCH_SCHEMA_VERSION,
      lastUsed: null,
      workspaces: [],
    };
  }
  if (typeof registry !== 'object' || registry === null) {
    const error = new Error('Workspace registry is corrupted.');
    error.code = 'WORKSPACE_REGISTRY_CORRUPTED';
    throw error;
  }
  return {
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: typeof registry.lastUsed === 'string' ? registry.lastUsed : null,
    workspaces: Array.isArray(registry.workspaces) ? registry.workspaces : [],
  };
}

async function writeRegistry(registry) {
  await initGlobal();
  await atomicWriteJson(getWorkspaceRegistryPath(), {
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: registry.lastUsed || null,
    workspaces: registry.workspaces,
  });
}

export async function readGlobalConfig() {
  await initGlobal();
  const config = await readJson(getWorkspaceConfigPath(), null);
  if (!config) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

export async function writeGlobalConfig(patch = {}) {
  const existing = await readGlobalConfig();
  const next = {
    ...existing,
    ...patch,
    version: WORKBENCH_SCHEMA_VERSION,
  };
  await atomicWriteJson(getWorkspaceConfigPath(), next);
  return next;
}

async function readPackageName(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = await readJson(pkgPath, null);
  if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
    return pkg.name.trim();
  }
  return path.basename(projectPath);
}

function normalizeWorkspaceRecord(record) {
  const snapshot = record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {};
  return {
    id: String(record.id),
    alias: String(record.alias),
    name: String(record.name || record.alias),
    path: normalizeProjectPath(record.path),
    addedAt: record.addedAt || nowIso(),
    lastOpenedAt: record.lastOpenedAt || record.addedAt || nowIso(),
    pinned: record.pinned === true,
    tags: uniqueTags(record.tags || []),
    available: record.available !== false,
    snapshot: {
      provider: snapshot.provider || null,
      model: snapshot.model || null,
      role: snapshot.role || null,
      activeTask: snapshot.activeTask || null,
      taskCount: Number.isFinite(snapshot.taskCount) ? snapshot.taskCount : 0,
      taskCounts: snapshot.taskCounts && typeof snapshot.taskCounts === 'object' ? { ...snapshot.taskCounts } : {},
      lastRefreshedAt: snapshot.lastRefreshedAt || null,
    },
  };
}

function resolveWorkspaceMatch(workspaces, aliasOrId) {
  const query = String(aliasOrId || '').trim().toLowerCase();
  const looksLikePath = query.includes(path.sep) || query.startsWith('.') || path.isAbsolute(aliasOrId || '');
  const normalizedPath = looksLikePath && query ? path.resolve(aliasOrId) : '';
  return workspaces.find((workspace) => {
    if (!query) {
      return false;
    }
    if (workspace.id === aliasOrId || workspace.alias.toLowerCase() === query) {
      return true;
    }
    return path.resolve(workspace.path) === normalizedPath;
  }) || null;
}

async function snapshotWorkspace(projectPath) {
  const root = normalizeProjectPath(projectPath);
  const exists = await fileExists(root);
  if (!exists) {
    return {
      available: false,
      provider: null,
      model: null,
      role: null,
      activeTask: null,
      taskCount: 0,
      taskCounts: {},
      lastRefreshedAt: nowIso(),
    };
  }

  const [state, tasks, currentTask, name] = await Promise.all([
    readProjectState(root).catch(() => null),
    listTasks(root).catch(() => ({ tasks: [] })),
    getCurrentTask(root).catch(() => null),
    readPackageName(root).catch(() => path.basename(root)),
  ]);

  const taskCounts = (tasks.tasks || []).reduce((acc, task) => {
    const status = String(task.status || 'draft');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    available: true,
    name,
    provider: state?.selectedProvider || null,
    model: state?.selectedModel || null,
    role: state?.activeRole || null,
    activeTask: currentTask?.id || state?.currentTaskId || null,
    taskCount: Array.isArray(tasks.tasks) ? tasks.tasks.length : 0,
    taskCounts,
    lastRefreshedAt: nowIso(),
  };
}

function createAliasForPath(projectPath, alias) {
  if (alias) {
    return validateAlias(alias);
  }
  return validateAlias(path.basename(projectPath));
}

function createWorkspaceId() {
  return `ws-${crypto.randomBytes(4).toString('hex')}`;
}

function sortWorkspaces(workspaces, sort = 'lastOpened') {
  const list = [...workspaces];
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (sort === 'name') {
      return a.alias.localeCompare(b.alias);
    }
    if (sort === 'added') {
      return String(b.addedAt || '').localeCompare(String(a.addedAt || ''));
    }
    return String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || ''));
  });
  return list;
}

export async function addWorkspace(projectPath, options = {}) {
  const root = normalizeProjectPath(projectPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) {
    const error = new Error(`Workspace path does not exist: ${projectPath}`);
    error.code = 'WORKSPACE_PATH_MISSING';
    error.path = projectPath;
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error(`Workspace path is not a directory: ${projectPath}`);
    error.code = 'WORKSPACE_PATH_NOT_DIRECTORY';
    error.path = projectPath;
    throw error;
  }

  const registry = await readRegistry();
  const existingByPath = registry.workspaces.find((workspace) => path.resolve(workspace.path) === root) || null;
  const requestedAlias = options.alias ? createAliasForPath(root, options.alias) : null;
  const nextAlias = existingByPath
    ? (requestedAlias || existingByPath.alias)
    : (requestedAlias || createAliasForPath(root));
  const existingByAlias = registry.workspaces.find((workspace) => workspace.alias === nextAlias) || null;

  if (existingByAlias && existingByPath && existingByAlias.id !== existingByPath.id) {
    const error = new Error(`Workspace alias already exists: ${nextAlias}`);
    error.code = 'WORKSPACE_DUPLICATE_ALIAS';
    error.alias = nextAlias;
    throw error;
  }
  if (existingByAlias && !existingByPath) {
    const error = new Error(`Workspace alias already exists: ${nextAlias}`);
    error.code = 'WORKSPACE_DUPLICATE_ALIAS';
    error.alias = nextAlias;
    throw error;
  }

  const snapshot = await snapshotWorkspace(root);
  const now = nowIso();
  let workspace;
  if (existingByPath) {
    workspace = normalizeWorkspaceRecord({
      ...existingByPath,
      alias: nextAlias || existingByPath.alias,
      name: options.name || existingByPath.name,
      pinned: options.pin === true ? true : options.pin === false ? false : existingByPath.pinned,
      tags: Array.isArray(options.tags) && options.tags.length
        ? uniqueTags([...existingByPath.tags, ...options.tags])
        : existingByPath.tags,
      lastOpenedAt: now,
      available: snapshot.available,
      snapshot,
    });
  } else {
    workspace = normalizeWorkspaceRecord({
      id: createWorkspaceId(),
      alias: nextAlias,
      name: options.name || snapshot.name || nextAlias,
      path: root,
      addedAt: now,
      lastOpenedAt: now,
      pinned: options.pin === true,
      tags: options.tags || [],
      available: snapshot.available,
      snapshot,
    });
  }

  const nextWorkspaces = registry.workspaces.filter((item) => item.id !== workspace.id && path.resolve(item.path) !== root && item.alias !== workspace.alias);
  nextWorkspaces.push(workspace);
  const nextRegistry = {
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: workspace.alias,
    workspaces: nextWorkspaces.map(normalizeWorkspaceRecord),
  };
  await writeRegistry(nextRegistry);
  return workspace;
}

export async function removeWorkspace(aliasOrId) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const nextWorkspaces = registry.workspaces.filter((workspace) => workspace.id !== target.id);
  const lastUsed = registry.lastUsed === target.alias ? (nextWorkspaces[0]?.alias || null) : registry.lastUsed;
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed,
    workspaces: nextWorkspaces,
  });
  return target;
}

export async function refreshSnapshot(aliasOrId) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const snapshot = await snapshotWorkspace(target.path);
  const nextWorkspace = normalizeWorkspaceRecord({
    ...target,
    available: snapshot.available,
    snapshot,
    name: snapshot.name || target.name,
  });
  const nextWorkspaces = registry.workspaces.map((workspace) => (workspace.id === target.id ? nextWorkspace : workspace));
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: registry.lastUsed,
    workspaces: nextWorkspaces,
  });
  return nextWorkspace;
}

export async function switchWorkspace(aliasOrId) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const refreshed = await refreshSnapshot(target.id);
  const nextWorkspaces = (await readRegistry()).workspaces;
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: refreshed.alias,
    workspaces: nextWorkspaces.map((workspace) => (
      workspace.id === refreshed.id
        ? normalizeWorkspaceRecord({
          ...workspace,
          lastOpenedAt: nowIso(),
          snapshot: refreshed.snapshot,
          available: refreshed.available,
        })
        : workspace
    )),
  });
  return refreshed;
}

export async function listWorkspaces(options = {}) {
  const registry = await readRegistry();
  const config = await readGlobalConfig();
  const sort = options.sort || config.listSort || 'lastOpened';
  const tagFilter = options.tag ? String(options.tag).trim() : '';
  let workspaces = [];
  for (const workspace of registry.workspaces) {
    workspaces.push(normalizeWorkspaceRecord({
      ...workspace,
      available: workspace.available !== false && await fileExists(workspace.path),
    }));
  }

  if (options.pinned === true) {
    workspaces = workspaces.filter((workspace) => workspace.pinned);
  }
  if (tagFilter) {
    workspaces = workspaces.filter((workspace) => workspace.tags.includes(tagFilter));
  }
  return sortWorkspaces(workspaces, sort).map((workspace) => ({
    ...workspace,
    current: registry.lastUsed === workspace.alias,
  }));
}

export async function getCurrentWorkspace() {
  const registry = await readRegistry();
  if (!registry.lastUsed) {
    return null;
  }
  const target = resolveWorkspaceMatch(registry.workspaces, registry.lastUsed);
  if (!target) {
    return null;
  }
  return normalizeWorkspaceRecord({
    ...target,
    available: target.available !== false && (await fileExists(target.path)),
  });
}

export async function renameWorkspace(aliasOrId, newAlias) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const alias = createAliasForPath(target.path, newAlias);
  const aliasConflict = registry.workspaces.find((workspace) => workspace.alias === alias && workspace.id !== target.id);
  if (aliasConflict) {
    const error = new Error(`Workspace alias already exists: ${alias}`);
    error.code = 'WORKSPACE_DUPLICATE_ALIAS';
    error.alias = alias;
    throw error;
  }
  const nextWorkspaces = registry.workspaces.map((workspace) => {
    if (workspace.id !== target.id) {
      return workspace;
    }
    return normalizeWorkspaceRecord({
      ...workspace,
      alias,
      name: workspace.name || alias,
    });
  });
  const nextLastUsed = registry.lastUsed === target.alias ? alias : registry.lastUsed;
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: nextLastUsed,
    workspaces: nextWorkspaces,
  });
  return nextWorkspaces.find((workspace) => workspace.id === target.id);
}

export async function pinWorkspace(aliasOrId, pinned = true) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const nextWorkspaces = registry.workspaces.map((workspace) => (
    workspace.id === target.id
      ? normalizeWorkspaceRecord({ ...workspace, pinned: Boolean(pinned) })
      : workspace
  ));
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: registry.lastUsed,
    workspaces: nextWorkspaces,
  });
  return nextWorkspaces.find((workspace) => workspace.id === target.id);
}

export async function tagWorkspace(aliasOrId, tag, remove = false) {
  const registry = await readRegistry();
  const target = resolveWorkspaceMatch(registry.workspaces, aliasOrId);
  if (!target) {
    const error = new Error(`Workspace not found: ${aliasOrId}`);
    error.code = 'WORKSPACE_NOT_FOUND';
    error.value = aliasOrId;
    throw error;
  }
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) {
    const error = new Error('Workspace tag is required.');
    error.code = 'WORKSPACE_TAG_REQUIRED';
    throw error;
  }
  const nextTags = new Set(target.tags);
  if (remove) {
    nextTags.delete(normalizedTag);
  } else {
    nextTags.add(normalizedTag);
  }
  const nextWorkspaces = registry.workspaces.map((workspace) => (
    workspace.id === target.id
      ? normalizeWorkspaceRecord({ ...workspace, tags: [...nextTags] })
      : workspace
  ));
  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: registry.lastUsed,
    workspaces: nextWorkspaces,
  });
  return nextWorkspaces.find((workspace) => workspace.id === target.id);
}

export async function searchWorkspaces(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return [];
  }
  const workspaces = await listWorkspaces({});
  return workspaces.filter((workspace) => {
    const haystack = [
      workspace.alias,
      workspace.name,
      workspace.path,
      ...(workspace.tags || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

async function walkWorkspaceCandidates(root, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_SCAN_DEPTH;
  const maxCount = Number.isFinite(options.maxCount) ? options.maxCount : DEFAULT_SCAN_LIMIT;
  const results = [];
  const queue = [{ dir: root, depth: 0 }];
  const seen = new Set();
  while (queue.length && results.length < maxCount) {
    const { dir, depth } = queue.shift();
    const resolved = normalizeRoot(dir);
    if (seen.has(resolved) || depth > maxDepth) {
      continue;
    }
    seen.add(resolved);

    const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
    const hasLocalCodex = entries.some((entry) => entry.isDirectory() && entry.name === '.local-codex');
    if (hasLocalCodex) {
      results.push(resolved);
    }

    if (depth === maxDepth) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith('.') && entry.name !== '.local-codex') {
        continue;
      }
      if (['node_modules', 'dist', 'build', 'coverage', 'Library', 'Applications', 'Downloads'].includes(entry.name)) {
        continue;
      }
      queue.push({ dir: path.join(resolved, entry.name), depth: depth + 1 });
    }
  }
  return results;
}

export async function repairWorkspaces() {
  await ensureDirectoryStructure();
  const home = process.env.WORKBENCH_HOME || os.homedir();
  const candidates = await walkWorkspaceCandidates(home);
  const nextWorkspaces = [];
  const usedAliases = new Set();

  for (const projectPath of candidates) {
    const snapshot = await snapshotWorkspace(projectPath);
    const baseAlias = createAliasForPath(projectPath);
    let alias = baseAlias;
    let suffix = 2;
    while (usedAliases.has(alias)) {
      alias = validateAlias(`${baseAlias}-${suffix}`);
      suffix += 1;
    }
    usedAliases.add(alias);
    nextWorkspaces.push(normalizeWorkspaceRecord({
      id: createWorkspaceId(),
      alias,
      name: snapshot.name || alias,
      path: normalizeProjectPath(projectPath),
      addedAt: snapshot.lastRefreshedAt || nowIso(),
      lastOpenedAt: snapshot.lastRefreshedAt || nowIso(),
      pinned: false,
      tags: [],
      available: snapshot.available,
      snapshot,
    }));
  }

  await writeRegistry({
    version: WORKBENCH_SCHEMA_VERSION,
    lastUsed: nextWorkspaces[0]?.alias || null,
    workspaces: nextWorkspaces,
  });
  return nextWorkspaces;
}
