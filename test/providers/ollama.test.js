import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider as createOllamaProvider } from '../../src/providers/ollama.js';

async function collectChunks(iterator) {
  const chunks = [];
  for await (const chunk of iterator) {
    chunks.push(chunk);
  }
  return chunks;
}

test('ollama provider streams chunks and lists models', async () => {
  const requests = [];
  const provider = createOllamaProvider(
    {
      baseUrl: 'http://ollama.test',
      defaultModel: 'qwen2.5-coder:14b',
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        if (url.endsWith('/api/tags')) {
          return new Response(JSON.stringify({
            models: [
              { name: 'qwen2.5-coder:14b' },
              { name: 'llama3.1:8b' },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/api/chat')) {
          return new Response(
            '{"message":{"content":"Hello "},"done":false}\n{"message":{"content":"world"},"done":true}\n',
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
  );

  const models = await provider.listModels();
  assert.deepEqual(models, ['qwen2.5-coder:14b', 'llama3.1:8b']);

  const chunks = await collectChunks(provider.chat([
    { role: 'user', content: 'Say hello' },
  ], { model: 'qwen2.5-coder:14b' }));

  assert.deepEqual(chunks, ['Hello ', 'world']);
  assert.equal(requests.some((request) => request.url.endsWith('/api/chat')), true);

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
});
