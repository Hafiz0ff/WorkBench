import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

async function startOllamaMock() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        models: [
          { name: 'qwen2.5-coder:14b' },
          { name: 'llama3.1:8b' },
        ],
      }));
      return;
    }
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: 'hello' }, done: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    host: `http://127.0.0.1:${port}`,
  };
}

test('provider CLI commands work with the active provider', async () => {
  const root = await createTempProject();
  const workbenchHome = await mkdtemp(path.join(os.tmpdir(), 'local-codex-provider-home-'));
  const mock = await startOllamaMock();
  const env = {
    ...process.env,
    WORKBENCH_HOME: workbenchHome,
    OLLAMA_HOST: mock.host,
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

  const setKeyResult = await execFileAsync(process.execPath, [CLI_PATH, 'provider', 'set-key', 'openai', 'openai-test-key'], {
    cwd: root,
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.match(setKeyResult.stdout.toString(), /API-ключ сохранён/);

  const providersConfig = JSON.parse(await readFile(path.join(root, '.local-codex', 'providers.json'), 'utf8'));
  assert.equal(providersConfig.providers.openai.enabled, true);
  assert.equal(providersConfig.providers.openai.apiKey, '@secret:openai_api_key');

  const secrets = JSON.parse(await readFile(path.join(workbenchHome, 'secrets.json'), 'utf8'));
  assert.equal(secrets.openai_api_key, 'openai-test-key');

  await new Promise((resolve) => mock.server.close(resolve));
});
