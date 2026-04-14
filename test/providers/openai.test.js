import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider as createOpenAIProvider } from '../../src/providers/openai.js';

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

test('openai provider completes, streams, lists models and reports health', async () => {
  const requests = [];
  const provider = createOpenAIProvider(
    {
      apiKey: 'sk-test',
      defaultModel: 'gpt-4o',
      timeout: 1000,
    },
    {
      requestImpl: async ({ url, method, body }) => {
        requests.push({ url, method, body: body ? JSON.parse(body) : null });
        if (url.endsWith('/models')) {
          return jsonResponse({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4o-mini' },
            ],
          });
        }
        if (url.endsWith('/chat/completions') && requests.at(-1)?.body?.stream === true) {
          return {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            bodyText: [
              'data: {"choices":[{"delta":{"content":"Hello "}}]}',
              '',
              'data: {"choices":[{"delta":{"content":"world"}}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
          };
        }
        if (url.endsWith('/chat/completions')) {
          const payload = requests.at(-1)?.body;
          assert.equal(payload.model, 'gpt-4o');
          assert.equal(payload.stream, false);
          assert.equal(payload.messages[0].role, 'user');
          return jsonResponse({
            choices: [{ message: { content: 'Hello world' } }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 3,
              total_tokens: 15,
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
  );

  const completion = await provider.complete([
    { role: 'user', content: 'Say hello' },
  ], { model: 'gpt-4o' });

  assert.equal(completion.content, 'Hello world');
  assert.equal(completion.provider, 'openai');
  assert.deepEqual(completion.usage, {
    promptTokens: 12,
    completionTokens: 3,
    totalTokens: 15,
  });

  const models = await provider.listModels();
  assert.deepEqual(models.map((model) => model.id), ['gpt-4o', 'gpt-4o-mini']);

  const chunks = await collectChunks(provider.stream([
    { role: 'user', content: 'Say hello' },
  ], { model: 'gpt-4o' }));
  assert.deepEqual(chunks, ['Hello ', 'world']);

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  assert.ok(health.latencyMs >= 0);

  assert.ok(requests.some((request) => request.url.endsWith('/models')));
  assert.ok(requests.some((request) => request.url.endsWith('/chat/completions')));
});
