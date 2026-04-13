import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ensureProvidersWorkspace } from '../../src/providers/index.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-provider-cli-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await ensureProvidersWorkspace(root);
  return root;
}

test('provider CLI commands work with the active provider', async () => {
  const root = await createTempProject();
  const mockImport = new URL('../../test/support/mock-provider-fetch.mjs', import.meta.url).href;
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${mockImport}`,
    MOCK_OLLAMA_MODELS: JSON.stringify([
      { name: 'qwen2.5-coder:14b' },
      { name: 'llama3.1:8b' },
    ]),
    APP_LOCALE: 'ru',
  };

  const listResult = await execFileAsync(process.execPath, [CLI_PATH, 'provider', 'list'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(listResult.stdout.toString(), /Провайдеры LLM/);
  assert.match(listResult.stdout.toString(), /ollama/);

  const modelListResult = await execFileAsync(process.execPath, [CLI_PATH, 'model', 'list'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(modelListResult.stdout.toString(), /qwen2.5-coder:14b/);

  const useResult = await execFileAsync(process.execPath, [CLI_PATH, 'provider', 'use', 'openai'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(useResult.stdout.toString(), /Провайдер переключён: openai/);

  const healthResult = await execFileAsync(process.execPath, [CLI_PATH, 'provider', 'health'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(healthResult.stdout.toString(), /ollama: .*доступен/);

  const setKeyResult = await execFileAsync(process.execPath, [CLI_PATH, 'provider', 'set-key', 'openai', 'sk-test'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(setKeyResult.stdout.toString(), /API-ключ сохранён/);

  const providersConfig = JSON.parse(await readFile(path.join(root, '.local-codex', 'providers.json'), 'utf8'));
  assert.equal(providersConfig.providers.openai.enabled, true);
  assert.equal(providersConfig.providers.openai.apiKey, 'sk-test');
});
