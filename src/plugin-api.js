import { emitter } from './events.js';

export class PluginPermissionError extends Error {
  constructor(pluginName, permission, methodName) {
    super(`Plugin "${pluginName}" does not have "${permission}" permission for ${methodName}.`);
    this.name = 'PluginPermissionError';
    this.code = 'PLUGIN_PERMISSION_ERROR';
    this.pluginName = pluginName;
    this.permission = permission;
    this.methodName = methodName;
  }
}

function hasPermission(manifest, permission) {
  const permissions = new Set(Array.isArray(manifest?.permissions) ? manifest.permissions.map((value) => String(value || '').trim()).filter(Boolean) : []);
  return permissions.has(permission) || permissions.has('*');
}

function createGuard(pluginName, manifest, permission, methodName, method) {
  return async (...args) => {
    if (!hasPermission(manifest, permission)) {
      throw new PluginPermissionError(pluginName, permission, methodName);
    }
    return method(...args);
  };
}

function prefixLogger(pluginName, method) {
  return (...args) => {
    method(`[plugin:${pluginName}]`, ...args);
  };
}

export function createPluginApi({
  pluginName,
  manifest,
  projectRoot,
  workbenchVersion,
  registry,
  services = {},
}) {
  if (!pluginName) {
    throw new Error('Plugin name is required.');
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Plugin manifest is required.');
  }
  if (!registry || typeof registry.registerHook !== 'function' || typeof registry.registerCommand !== 'function') {
    throw new Error('Plugin registry is required.');
  }

  const api = {
    on(hookName, handler) {
      registry.registerHook(hookName, pluginName, handler, api);
    },
    registerCommand(name, handler) {
      registry.registerCommand(name, pluginName, handler, api);
    },
    memory: {
      getNotes: createGuard(pluginName, manifest, 'read-memory', 'memory.getNotes', services.getNotes || (async () => [])),
      getTasks: createGuard(pluginName, manifest, 'read-memory', 'memory.getTasks', services.getTasks || (async () => [])),
      getDocs: createGuard(pluginName, manifest, 'read-memory', 'memory.getDocs', services.getDocs || (async () => [])),
      search: createGuard(pluginName, manifest, 'read-memory', 'memory.search', services.searchMemory || (async () => ({ query: '', results: [], durationMs: 0, embeddingModel: null }))),
    },
    code: {
      search: createGuard(pluginName, manifest, 'read-code', 'code.search', services.searchCode || (async () => ({ query: '', results: [], durationMs: 0, embeddingModel: null }))),
      readFile: createGuard(pluginName, manifest, 'read-code', 'code.readFile', services.readFile || (async () => '')),
    },
    notes: {
      append: createGuard(pluginName, manifest, 'write-notes', 'notes.append', services.appendNote || (async () => {})),
      write: createGuard(pluginName, manifest, 'write-notes', 'notes.write', services.writeNote || (async () => {})),
    },
    events: {
      emit(eventName, payload = {}) {
        if (typeof eventName !== 'string' || !eventName.startsWith('workbench:plugin:')) {
          throw new PluginPermissionError(pluginName, 'workbench:plugin:*', 'events.emit');
        }
        emitter.emit(eventName, {
          ...payload,
          plugin: pluginName,
          projectRoot,
        });
      },
    },
    log: prefixLogger(pluginName, console.log),
    warn: prefixLogger(pluginName, console.warn),
    error: prefixLogger(pluginName, console.error),
    config: manifest,
    manifest,
    projectRoot,
    workbenchVersion,
  };

  return api;
}
