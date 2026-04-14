import assert from 'node:assert/strict';
import test from 'node:test';
import { emitter } from '../src/events.js';
import { createPluginApi, PluginPermissionError } from '../src/plugin-api.js';

function createRegistryStub() {
  const hooks = [];
  const commands = [];
  return {
    hooks,
    commands,
    registerHook(hookName, pluginName, handler, api) {
      hooks.push({ hookName, pluginName, handler, api });
    },
    registerCommand(name, pluginName, handler, api) {
      commands.push({ name, pluginName, handler, api });
    },
  };
}

test('plugin api guards permissions and namespaces events', async () => {
  const registry = createRegistryStub();
  const emitted = [];
  const listener = (event) => emitted.push(event);
  emitter.on('workbench:plugin:ping', listener);
  let logged = '';
  const originalLog = console.log;
  console.log = (...args) => {
    logged = args.join(' ');
  };

  try {
    const api = createPluginApi({
      pluginName: 'guarded-plugin',
      manifest: {
        permissions: ['read-memory', 'write-notes'],
      },
      projectRoot: '/tmp/project',
      workbenchVersion: '2.3.0',
      registry,
      services: {
        getNotes: async () => ['note'],
        appendNote: async () => {},
      },
    });

    await assert.rejects(api.code.readFile('src/app.js'), PluginPermissionError);
    assert.throws(() => api.events.emit('workbench:core:ping', {}), PluginPermissionError);

    api.events.emit('workbench:plugin:ping', { ok: true });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].plugin, 'guarded-plugin');
    assert.equal(emitted[0].projectRoot, '/tmp/project');

    const notes = await api.memory.getNotes();
    assert.deepEqual(notes, ['note']);

    api.log('hello');
    assert.match(logged, /\[plugin:guarded-plugin\]/);

    api.registerCommand('echo', async () => 'ok');
    assert.equal(registry.commands.length, 1);
    assert.equal(registry.commands[0].name, 'echo');
  } finally {
    console.log = originalLog;
    emitter.off('workbench:plugin:ping', listener);
  }
});
