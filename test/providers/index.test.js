import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  DEFAULT_PROVIDER_CONFIG,
  completeWithFallback,
  getProvider,
  writeProvidersConfig,
} from '../../src/providers/index.js';
import { emitter } from '../../src/events.js';

async function createProjectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-provider-index-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  return root;
}

async function startProviderServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

test('provider registry resolves providers and falls back on retryable errors', async () => {
  const root = await createProjectRoot();
  const providerServer = await startProviderServer((req, res) => {
    if (req.url.startsWith('/openai-fail/chat/completions')) {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0.001' });
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    if (req.url.startsWith('/ollama-ok/api/chat')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: 'fallback ok' }, done: true }));
      return;
    }
    if (req.url.startsWith('/openai-auth/chat/completions')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const config = structuredClone(DEFAULT_PROVIDER_CONFIG);
  config.active = 'openai';
  config.fallback = 'ollama';
  config.providers.openai = {
    ...config.providers.openai,
    enabled: true,
    apiKey: 'sk-test',
    baseUrl: `${providerServer.baseUrl}/openai-fail`,
    model: 'gpt-4o',
    defaultModel: 'gpt-4o',
    maxRetries: 0,
  };
  config.providers.ollama = {
    ...config.providers.ollama,
    enabled: true,
    baseUrl: `${providerServer.baseUrl}/ollama-ok`,
    model: 'qwen2.5-coder:14b',
    defaultModel: 'qwen2.5-coder:14b',
    maxRetries: 0,
  };
  await writeProvidersConfig(root, config);

  const provider = await getProvider(root, 'openai');
  assert.equal(provider.name, 'openai');
  assert.equal(provider.defaultModel, 'gpt-4o');

  const events = [];
  const listener = (event) => events.push(event);
  emitter.on('workbench:event', listener);
  try {
    const result = await completeWithFallback(root, [
      { role: 'user', content: 'Hello' },
    ], { provider: 'openai', model: 'gpt-4o' });
    assert.equal(result.content, 'fallback ok');
    assert.ok(events.some((event) => event.type === 'provider.fallback'));
  } finally {
    emitter.off('workbench:event', listener);
    await new Promise((resolve) => providerServer.server.close(resolve));
  }
});

test('provider registry does not fallback on authentication errors', async () => {
  const root = await createProjectRoot();
  const providerServer = await startProviderServer((req, res) => {
    if (req.url.startsWith('/openai-auth/chat/completions')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
      return;
    }
    if (req.url.startsWith('/ollama-ok/api/chat')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: 'fallback ok' }, done: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const config = structuredClone(DEFAULT_PROVIDER_CONFIG);
  config.active = 'openai';
  config.fallback = 'ollama';
  config.providers.openai = {
    ...config.providers.openai,
    enabled: true,
    apiKey: 'sk-test',
    baseUrl: `${providerServer.baseUrl}/openai-auth`,
    model: 'gpt-4o',
    defaultModel: 'gpt-4o',
    maxRetries: 0,
  };
  config.providers.ollama = {
    ...config.providers.ollama,
    enabled: true,
    baseUrl: `${providerServer.baseUrl}/ollama-ok`,
    model: 'qwen2.5-coder:14b',
    defaultModel: 'qwen2.5-coder:14b',
    maxRetries: 0,
  };
  await writeProvidersConfig(root, config);

  const events = [];
  const listener = (event) => events.push(event);
  emitter.on('workbench:event', listener);
  try {
    await assert.rejects(() => completeWithFallback(root, [
      { role: 'user', content: 'Hello' },
    ], { provider: 'openai', model: 'gpt-4o' }), /401/);
    assert.equal(events.some((event) => event.type === 'provider.fallback'), false);
  } finally {
    emitter.off('workbench:event', listener);
    await new Promise((resolve) => providerServer.server.close(resolve));
  }
});
