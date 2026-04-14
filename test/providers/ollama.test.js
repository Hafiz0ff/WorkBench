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

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bodyText: JSON.stringify(body),
  };
}

test('ollama provider completes, streams, lists models and reports health', async () => {
  const requests = [];
  const provider = createOllamaProvider(
    {
      baseUrl: 'http://ollama.test',
      defaultModel: 'qwen2.5-coder:14b',
    },
    {
      requestImpl: async ({ url, method, body }) => {
        requests.push({ url, method, body: body ? JSON.parse(body) : null });
        if (url.endsWith('/api/tags')) {
          return jsonResponse({
            models: [
              { name: 'qwen2.5-coder:14b' },
              { name: 'llama3.1:8b' },
            ],
          });
        }
        if (url.endsWith('/api/chat') && requests.at(-1)?.body?.stream === true) {
          return {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
            bodyText: [
              '{"message":{"content":"Hello "},"done":false}',
              '{"message":{"content":"world"},"done":true}',
              '',
            ].join('\n'),
          };
        }
        if (url.endsWith('/api/chat')) {
          const payload = requests.at(-1)?.body;
          assert.equal(payload.model, 'qwen2.5-coder:14b');
          assert.equal(payload.stream, false);
          assert.equal(payload.messages[0].role, 'user');
          return jsonResponse({
            message: { content: 'Hello world' },
            done: true,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
  );

  const completion = await provider.complete([
    { role: 'user', content: 'Say hello' },
  ], { model: 'qwen2.5-coder:14b' });
  assert.equal(completion.content, 'Hello world');
  assert.equal(completion.provider, 'ollama');
  assert.equal(completion.usage, null);

  const models = await provider.listModels();
  assert.deepEqual(models.map((model) => model.id), ['qwen2.5-coder:14b', 'llama3.1:8b']);

  const chunks = await collectChunks(provider.stream([
    { role: 'user', content: 'Say hello' },
  ], { model: 'qwen2.5-coder:14b' }));
  assert.deepEqual(chunks, ['Hello ', 'world']);

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  assert.ok(requests.some((request) => request.url.endsWith('/api/tags')));
});
