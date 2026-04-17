import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { ensureProvidersWorkspace, getProvider, setProviderApiKey, useProvider } from '../../src/providers/index.js';
import { readProjectState } from '../../src/memory.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-provider-factory-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  return root;
}

test('provider factory loads the default provider and persists selection', async () => {
  const root = await createTempProject();
  const configPath = await ensureProvidersWorkspace(root);
  assert.ok(configPath.endsWith(path.join('.local-codex', 'providers.json')));

  const defaultProvider = await getProvider(root);
  assert.equal(defaultProvider.name, 'ollama');
  assert.equal(defaultProvider.defaultModel, 'qwen2.5-coder:14b');

  await useProvider(root, 'openai');
  const stateAfterUse = await readProjectState(root);
  assert.equal(stateAfterUse.selectedProvider, 'openai');
  assert.equal(stateAfterUse.selectedModel, 'gpt-4o');

  await setProviderApiKey(root, 'openai', 'provider-test-key');
  const openaiProvider = await getProvider(root, 'openai');
  assert.equal(openaiProvider.name, 'openai');
  assert.equal(openaiProvider.defaultModel, 'gpt-4o');
});
