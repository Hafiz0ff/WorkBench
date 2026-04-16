import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { emitter } from './events.js';
import { normalizeRoot } from './security.js';
import { readProjectPolicy, writeProjectPolicy } from './policy.js';
import { readProjectState, showMemoryEntry, listMemoryModuleSummaries, ensureProjectMemory } from './memory.js';
import { listTasks } from './tasks.js';
import { readProjectFile } from './project.js';
import { listEvents, trackEvent } from './stats.js';
import { createPluginApi, PluginPermissionError } from './plugin-api.js';

const WORKBENCH_HOME_DIR = '.workbench';
const EXTENSIONS_GLOBAL_DIR = 'extensions';
const EXTENSIONS_LOCAL_DIR = path.join('.local-codex', 'extensions');
const WORKBENCH_MANIFEST_FILE = 'workbench.json';
const WORKBENCH_INDEX_FILE = 'index.js';
const WORKBENCH_VERSION_CACHE_TTL_MS = 60 * 1000;

const registryCache = new Map();
const bridgeHandlers = new Map();
let bridgeAttached = false;

function nowIso() {
  return new Date().toISOString();
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

async function writeJsonFile(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function slugifyName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function parseVersionParts(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  if (!a || !b) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] > b[index] ? 1 : -1;
    }
  }
  return 0;
}

function normalizeWorkbenchHome() {
  return path.resolve(process.env.WORKBENCH_HOME || path.join(os.homedir(), WORKBENCH_HOME_DIR));
}

function getGlobalExtensionsRoot() {
  return path.join(normalizeWorkbenchHome(), EXTENSIONS_GLOBAL_DIR);
}

function getLocalExtensionsRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), EXTENSIONS_LOCAL_DIR);
}

function getWorkspaceVersionPath(projectRoot) {
  return path.join(normalizeRoot(projectRoot), 'package.json');
}

async function readWorkspaceVersion(projectRoot) {
  const pkg = await readJsonFile(getWorkspaceVersionPath(projectRoot), null);
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
}

function normalizeArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeManifest(manifest, { scope, directory, workbenchVersion = '0.0.0' }) {
  const warnings = [];
  if (!manifest || typeof manifest !== 'object') {
    return {
      valid: false,
      warnings: ['Manifest is missing or invalid.'],
      plugin: null,
    };
  }

  const name = typeof manifest.name === 'string' && manifest.name.trim()
    ? manifest.name.trim()
    : slugifyName(path.basename(directory));
  const version = typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : '';
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : '';
  const author = typeof manifest.author === 'string' ? manifest.author.trim() : '';
  const hooks = normalizeArray(manifest.hooks);
  const commands = normalizeArray(manifest.commands);
  const permissions = normalizeArray(manifest.permissions);
  const enabled = manifest.enabled !== false;
  const minWorkbenchVersion = typeof manifest.minWorkbenchVersion === 'string' && manifest.minWorkbenchVersion.trim()
    ? manifest.minWorkbenchVersion.trim()
    : '0.0.0';
  const main = typeof manifest.main === 'string' && manifest.main.trim() ? manifest.main.trim() : WORKBENCH_INDEX_FILE;

  if (!name) {
    warnings.push('Manifest name is missing.');
  }
  if (!version) {
    warnings.push('Manifest version is missing.');
  }
  if (!description) {
    warnings.push('Manifest description is missing.');
  }

  const entryPoint = path.join(directory, main);
  const normalized = {
    ...manifest,
    name,
    version,
    description,
    author,
    hooks,
    commands,
    permissions,
    enabled,
    minWorkbenchVersion,
    main,
  };

  const compatible = compareVersions(workbenchVersion, minWorkbenchVersion) >= 0;

  return {
    valid: warnings.length === 0,
    warnings,
    compatible,
    plugin: {
      name,
      version,
      description,
      author,
      hooks,
      commands,
      permissions,
      enabled,
      scope,
      directory,
      manifestPath: path.join(directory, WORKBENCH_MANIFEST_FILE),
      entryPoint,
      manifest: normalized,
      minWorkbenchVersion,
      loaded: false,
      warnings: [...warnings],
      compatible,
      stats: {
        hookCalls: 0,
        errorCalls: 0,
        lastCalledAt: null,
      },
    },
  };
}

function buildPluginServices(root) {
  const notesRoot = path.join(root, '.local-codex', 'notes');
  return {
    async getNotes() {
      await ensureDir(notesRoot);
      const entries = await fs.readdir(notesRoot, { withFileTypes: true }).catch(() => []);
      const files = [];
      for (const entry of entries) {
        const filePath = path.join(notesRoot, entry.name);
        if (entry.isDirectory()) {
          continue;
        }
        if (!entry.name.endsWith('.md')) {
          continue;
        }
        files.push({
          path: path.relative(root, filePath),
          content: await readTextFile(filePath),
        });
      }
      return files;
    },
    async getTasks() {
      const taskData = await listTasks(root).catch(() => ({ tasks: [] }));
      return Array.isArray(taskData.tasks) ? taskData.tasks : [];
    },
    async getDocs() {
      const docs = [];
      const names = ['project_overview', 'architecture_notes', 'decisions_log'];
      for (const name of names) {
        const content = await showMemoryEntry(root, name).catch(() => '');
        docs.push({
          path: `.local-codex/${name}.md`,
          content,
        });
      }
      return docs;
    },
    async searchMemory(query, opts = {}) {
      const { semanticSearch } = await import('./search.js');
      return semanticSearch(root, query, {
        ...opts,
        sources: ['memory'],
      });
    },
    async searchCode(query, opts = {}) {
      const { semanticSearch } = await import('./search.js');
      return semanticSearch(root, query, {
        ...opts,
        sources: ['code'],
      });
    },
    async readFile(relativePath) {
      const policy = await readProjectPolicy(root).catch(() => null);
      return readProjectFile(root, relativePath, 20000, { policy });
    },
    async appendNote(filename, content) {
      await ensureDir(notesRoot);
      const safeName = String(filename || '').replace(/[\\/]+/g, '/').replace(/\.\.+/g, '');
      const filePath = path.join(notesRoot, safeName.endsWith('.md') ? safeName : `${safeName}.md`);
      const current = await readTextFile(filePath).catch(() => '');
      const next = `${current.trimEnd()}${current ? '\n\n' : ''}${String(content || '')}`.trimEnd();
      await fs.writeFile(filePath, `${next}\n`, 'utf8');
    },
    async writeNote(filename, content) {
      await ensureDir(notesRoot);
      const safeName = String(filename || '').replace(/[\\/]+/g, '/').replace(/\.\.+/g, '');
      const filePath = path.join(notesRoot, safeName.endsWith('.md') ? safeName : `${safeName}.md`);
      await fs.writeFile(filePath, `${String(content || '')}\n`, 'utf8');
    },
  };
}

async function scanExtensionRoot(root, scope, workbenchVersion) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  const issues = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    const directory = path.join(root, entry.name);
    const manifestPath = path.join(directory, WORKBENCH_MANIFEST_FILE);
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    const manifest = await readJsonFile(manifestPath, null);
    const normalized = normalizeManifest(manifest, { scope, directory, workbenchVersion });
    if (!normalized.plugin) {
      issues.push({
        scope,
        name: entry.name,
        path: directory,
        message: 'Manifest is invalid.',
      });
      continue;
    }
    if (!normalized.valid) {
      issues.push({
        scope,
        name: normalized.plugin.name,
        path: directory,
        message: normalized.warnings.join('; '),
      });
    }
    if (!normalized.compatible) {
      issues.push({
        scope,
        name: normalized.plugin.name,
        path: directory,
        message: `Requires WorkBench >= ${normalized.plugin.minWorkbenchVersion}.`,
      });
    }
    plugins.push(normalized.plugin);
  }
  return { plugins, issues };
}

export async function scanExtensions(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const appVersion = await readWorkspaceVersion(root).catch(() => '0.0.0');
  const globalRoot = getGlobalExtensionsRoot();
  const localRoot = getLocalExtensionsRoot(root);
  const discovered = new Map();
  const issues = [];

  if (await fileExists(globalRoot)) {
    const result = await scanExtensionRoot(globalRoot, 'global', appVersion);
    for (const issue of result.issues) {
      issues.push(issue);
    }
    for (const plugin of result.plugins) {
      if (discovered.has(plugin.name)) {
        discovered.delete(plugin.name);
      }
      discovered.set(plugin.name, plugin);
    }
  }

  if (await fileExists(localRoot)) {
    const result = await scanExtensionRoot(localRoot, 'local', appVersion);
    for (const issue of result.issues) {
      issues.push(issue);
    }
    for (const plugin of result.plugins) {
      if (discovered.has(plugin.name)) {
        discovered.delete(plugin.name);
      }
      discovered.set(plugin.name, plugin);
    }
  }

  return {
    plugins: [...discovered.values()],
    issues,
  };
}

function getRegistryCacheKey(projectRoot) {
  return normalizeRoot(projectRoot);
}

function attachWorkbenchEventBridge(projectRoot, registry) {
  const root = normalizeRoot(projectRoot);
  if (bridgeHandlers.has(root)) {
    return;
  }
  const handler = (event) => {
    if (!event || !event.projectRoot || normalizeRoot(event.projectRoot) !== root) {
      return;
    }
    if (String(event.type || '').startsWith('extension.')) {
      return;
    }
    void registry.runHook('on-event', {
      type: event.type,
      payload: event,
    }, {}).catch(() => {});
  };
  emitter.on('workbench:event', handler);
  bridgeHandlers.set(root, handler);
}

function detachWorkbenchEventBridge(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const handler = bridgeHandlers.get(root);
  if (!handler) {
    return;
  }
  emitter.off('workbench:event', handler);
  bridgeHandlers.delete(root);
}

function createRegistry(projectRoot, policy, pluginList = []) {
  const root = normalizeRoot(projectRoot);
  const plugins = [];
  const hookHandlers = new Map();
  const commandHandlers = new Map();
  const pluginMap = new Map();
  const services = buildPluginServices(root);
  const registry = {
    projectRoot: root,
    policy,
    loadedAt: nowIso(),
    plugins,
    commands: commandHandlers,
    issues: [],
    warnings: [],
    registerHook(hookName, pluginName, handler, api) {
      const name = String(hookName || '').trim();
      if (!name || typeof handler !== 'function') {
        throw new Error(`Invalid hook registration for plugin ${pluginName}.`);
      }
      const list = hookHandlers.get(name) || [];
      list.push({ pluginName, handler, api });
      hookHandlers.set(name, list);
    },
    registerCommand(name, pluginName, handler, api) {
      const command = String(name || '').trim();
      if (!command || typeof handler !== 'function') {
        throw new Error(`Invalid command registration for plugin ${pluginName}.`);
      }
      if (commandHandlers.has(command)) {
        registry.warnings.push(`Command "${command}" was overridden by plugin "${pluginName}".`);
      }
      commandHandlers.set(command, { pluginName, handler, api });
    },
    registerPlugin(plugin) {
      if (!plugin || typeof plugin !== 'object') {
        return;
      }
      pluginMap.set(plugin.name, plugin);
      plugins.push(plugin);
    },
    async runHook(hookName, ctx, options = {}) {
      const handlers = hookHandlers.get(String(hookName || '').trim()) || [];
      if (!handlers.length) {
        return ctx;
      }
      let current = ctx;
      for (const entry of handlers) {
        const startedAt = Date.now();
        try {
          const result = await entry.handler(current);
          if (result !== undefined) {
            current = result;
          }
          const durationMs = Date.now() - startedAt;
          const aborted = Boolean(current && typeof current === 'object' && current.abort);
          const event = {
            projectRoot: root,
            plugin: entry.pluginName,
            hook: hookName,
            durationMs,
            aborted,
          };
          if (!options.skipMetrics) {
            void trackEvent(root, {
              type: 'extension.hook',
              ...event,
            }).catch(() => {});
          }
          emitter.emit('extension:hook', event);
          if (entry.api?.log && !options.skipLogging) {
            entry.api.log(`${hookName} completed in ${durationMs}ms`);
          }
          if (aborted) {
            break;
          }
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const message = error instanceof Error ? error.message : String(error);
          const event = {
            projectRoot: root,
            plugin: entry.pluginName,
            hook: hookName,
            durationMs,
            error: message,
          };
          if (!options.skipMetrics) {
            void trackEvent(root, {
              type: 'extension.error',
              ...event,
            }).catch(() => {});
          }
          emitter.emit('extension:error', event);
          if (entry.api?.error && !options.skipLogging) {
            entry.api.error(`${hookName} failed: ${message}`);
          }
        }
      }
      return current;
    },
    async runCommand(name, args = []) {
      const command = commandHandlers.get(String(name || '').trim());
      if (!command) {
        throw new Error(`Command not found: ${name}`);
      }
      return command.handler(args, command.api);
    },
    getPlugin(name) {
      return pluginMap.get(String(name || '').trim()) || null;
    },
    listHooks() {
      return [...hookHandlers.entries()].map(([hook, handlers]) => ({
        hook,
        plugins: handlers.map((entry) => entry.pluginName),
      }));
    },
  };

  for (const plugin of pluginList) {
      const api = createPluginApi({
        pluginName: plugin.name,
        manifest: plugin.manifest,
        projectRoot: root,
      workbenchVersion: plugin.workbenchVersion,
      registry,
      services,
      });
      plugin.api = api;
      registry.registerPlugin(plugin);
    }

  return registry;
}

async function loadPluginModule(entry) {
  const moduleUrl = pathToFileURL(entry.entryPoint).href;
  const cacheKey = `${moduleUrl}?v=${encodeURIComponent(`${entry.manifestPath}:${entry.version}`)}`;
  return import(cacheKey);
}

export async function loadExtensions(projectRoot, policy = null, { force = false } = {}) {
  const root = normalizeRoot(projectRoot);
  const cacheKey = getRegistryCacheKey(root);
  if (!force && registryCache.has(cacheKey)) {
    return registryCache.get(cacheKey);
  }

  const appVersion = await readWorkspaceVersion(root).catch(() => '0.0.0');
  const scanned = await scanExtensions(root);
  const enabledPlugins = scanned.plugins.filter((plugin) => plugin.enabled !== false);
  const registry = createRegistry(root, policy, []);
  registry.issues.push(...scanned.issues);
  attachWorkbenchEventBridge(root, registry);

  for (const plugin of enabledPlugins) {
    const compatible = compareVersions(appVersion, plugin.minWorkbenchVersion || '0.0.0') >= 0;
    if (!compatible) {
      registry.warnings.push(`Plugin "${plugin.name}" requires WorkBench >= ${plugin.minWorkbenchVersion}.`);
    }
    try {
      const module = await loadPluginModule(plugin);
      const register = typeof module?.default === 'function'
        ? module.default
        : typeof module?.register === 'function'
          ? module.register
          : typeof module === 'function'
            ? module
            : null;
      if (!register) {
        throw new Error(`Plugin "${plugin.name}" does not export a register function.`);
      }
      const api = createPluginApi({
        pluginName: plugin.name,
        manifest: plugin.manifest,
        projectRoot: root,
        workbenchVersion: appVersion,
        registry,
        services: buildPluginServices(root),
      });
      plugin.api = api;
      await register(api);
      plugin.loaded = true;
      plugin.workbenchVersion = appVersion;
      plugin.compatible = compatible;
      registry.registerPlugin(plugin);
      emitter.emit('extension:loaded', {
        projectRoot: root,
        name: plugin.name,
        version: plugin.version,
        scope: plugin.scope,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      registry.issues.push({
        name: plugin.name,
        scope: plugin.scope,
        path: plugin.directory,
        message,
      });
      emitter.emit('extension:error', {
        projectRoot: root,
        plugin: plugin.name,
        hook: 'register',
        error: message,
      });
      void trackEvent(root, {
        type: 'extension.error',
        plugin: plugin.name,
        hook: 'register',
        error: message,
      }).catch(() => {});
    }
  }
  registryCache.set(cacheKey, registry);
  return registry;
}

export function invalidateExtensionsCache(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const cacheKey = getRegistryCacheKey(root);
  registryCache.delete(cacheKey);
  detachWorkbenchEventBridge(root);
}

export async function getLoadedExtensions(projectRoot, policy = null, options = {}) {
  return loadExtensions(projectRoot, policy, options);
}

export async function runExtensionHook(projectRoot, hookName, ctx, options = {}) {
  const registry = await loadExtensions(projectRoot, options.policy || null, options);
  return registry.runHook(hookName, ctx, options);
}

export async function runExtensionCommand(projectRoot, name, args = [], options = {}) {
  const registry = await loadExtensions(projectRoot, options.policy || null, options);
  return registry.runCommand(name, args, options);
}

export async function listExtensions(projectRoot) {
  const { plugins } = await scanExtensions(projectRoot);
  return plugins.map((plugin) => ({
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author,
    hooks: [...plugin.hooks],
    commands: [...plugin.commands],
    permissions: [...plugin.permissions],
    enabled: Boolean(plugin.enabled),
    scope: plugin.scope,
    loaded: Boolean(plugin.loaded),
    directory: plugin.directory,
    manifestPath: plugin.manifestPath,
    main: plugin.main,
    minWorkbenchVersion: plugin.minWorkbenchVersion,
    compatible: plugin.compatible !== false,
    warnings: Array.isArray(plugin.warnings) ? [...plugin.warnings] : [],
  }));
}

async function collectPluginStats(projectRoot, pluginName) {
  const events = await listEvents(projectRoot, {
    limit: 1000,
    reverse: true,
    type: ['extension.hook', 'extension.error'],
  });
  const hooks = events.filter((event) => event.plugin === pluginName && event.type === 'extension.hook');
  const errors = events.filter((event) => event.plugin === pluginName && event.type === 'extension.error');
  const lastCalledAt = hooks[0]?.ts || errors[0]?.ts || null;
  return {
    hookCalls: hooks.length,
    errorCalls: errors.length,
    lastCalledAt,
    hooksByName: hooks.reduce((acc, event) => {
      const hook = String(event.hook || 'unknown').trim() || 'unknown';
      acc[hook] = (acc[hook] || 0) + 1;
      return acc;
    }, {}),
  };
}

export async function describeExtension(projectRoot, name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('Extension name is required.');
  }
  const all = await listExtensions(projectRoot);
  const extension = all.find((plugin) => plugin.name === normalizedName);
  if (!extension) {
    return null;
  }
  return {
    ...extension,
    stats: await collectPluginStats(projectRoot, normalizedName),
  };
}

function pluginRootForScope(projectRoot, scope) {
  return scope === 'global' ? getGlobalExtensionsRoot() : getLocalExtensionsRoot(projectRoot);
}

function normalizeExtensionFolderName(name) {
  const slug = slugifyName(name);
  if (!slug) {
    throw new Error(`Invalid extension name: ${name}`);
  }
  return slug;
}

async function findExtensionDirectory(projectRoot, name) {
  const extension = await describeExtension(projectRoot, name);
  if (!extension) {
    return null;
  }
  return extension.directory;
}

async function writeExtensionManifest(directory, manifest) {
  await ensureDir(directory);
  await writeJsonFile(path.join(directory, WORKBENCH_MANIFEST_FILE), manifest);
}

export async function setLoadedExtensionEnabled(projectRoot, name, enabled) {
  const root = normalizeRoot(projectRoot);
  const extension = await describeExtension(root, name);
  if (!extension) {
    throw new Error(`Extension not found: ${name}`);
  }
  const manifest = await readJsonFile(path.join(extension.directory, WORKBENCH_MANIFEST_FILE), null);
  if (!manifest) {
    throw new Error(`Manifest is missing for ${name}`);
  }
  manifest.enabled = Boolean(enabled);
  manifest.updatedAt = nowIso();
  await writeExtensionManifest(extension.directory, manifest);
  invalidateExtensionsCache(root);
  return {
    ...extension,
    enabled: Boolean(enabled),
    manifest,
  };
}

export async function removeLoadedExtension(projectRoot, name) {
  const root = normalizeRoot(projectRoot);
  const extension = await describeExtension(root, name);
  if (!extension) {
    throw new Error(`Extension not found: ${name}`);
  }
  await fs.rm(extension.directory, { recursive: true, force: true });
  invalidateExtensionsCache(root);
  return extension;
}

export async function scaffoldExtension(projectRoot, name, options = {}) {
  const root = normalizeRoot(projectRoot);
  const scope = options.global === true ? 'global' : 'local';
  const baseRoot = pluginRootForScope(root, scope);
  const pluginName = normalizeExtensionFolderName(name);
  const directory = path.join(baseRoot, pluginName);
  if (await fileExists(directory)) {
    throw new Error(`Extension directory already exists: ${directory}`);
  }
  await ensureDir(directory);
  const workbenchVersion = await readWorkspaceVersion(root).catch(() => '2.3.2');
  const hooks = normalizeArray(options.hooks || []);
  const manifest = {
    name: pluginName,
    version: '0.1.0',
    description: 'TODO: описание',
    author: '',
    hooks,
    commands: [],
    permissions: [],
    minWorkbenchVersion: workbenchVersion,
    enabled: true,
  };
  const indexJs = `/**
 * ${pluginName} - WorkBench Extension
 * Hooks: ${hooks.length ? hooks.join(', ') : 'none'}
 */
export default function register(api) {
  ${hooks.includes('pre-patch') ? `api.on('pre-patch', async (ctx) => {
    api.log('pre-patch triggered', ctx.patch?.filePath || '');
    return ctx;
  });` : ''}
  ${hooks.includes('post-patch') ? `api.on('post-patch', async (ctx) => {
    api.log('post-patch triggered', ctx.success);
    return ctx;
  });` : ''}
}
`;
  const readme = `# ${pluginName}

WorkBench extension.

## Installation

${scope === 'global' ? 'Installed globally in' : 'Installed locally in'} \`${directory}\`.

## Hooks

${hooks.length ? hooks.map((hook) => `- \`${hook}\``).join('\n') : '- None yet.'}

## Configuration

Edit \`workbench.json\` to configure permissions and metadata.
`;
  await writeJsonFile(path.join(directory, WORKBENCH_MANIFEST_FILE), manifest);
  await fs.writeFile(path.join(directory, WORKBENCH_INDEX_FILE), indexJs, 'utf8');
  await fs.writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: pluginName,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: manifest.description,
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(directory, 'README.md'), `${readme.trimEnd()}\n`, 'utf8');
  invalidateExtensionsCache(root);
  return {
    directory,
    scope,
    manifest,
  };
}

export async function getExtensionHistory(projectRoot, name) {
  const stats = await collectPluginStats(projectRoot, name);
  return stats;
}

export { PluginPermissionError };
