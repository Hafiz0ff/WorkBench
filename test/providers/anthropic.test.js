import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider as createAnthropicProvider } from '../../src/providers/anthropic.js';

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

test('anthropic provider converts messages, streams chunks and lists models', async () => {
  const requests = [];
  const provider = createAnthropicProvider(
    {
      apiKey: 'anthropic-test',
      defaultModel: 'claude-sonnet-4-5',
      maxTokens: 2048,
    },
    {
      requestImpl: async ({ url, method, body }) => {
        requests.push({ url, method, body: body ? JSON.parse(body) : null });
        if (url.endsWith('/v1/models')) {
          return jsonResponse({
            data: [
              { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', context_window: 200000 },
              { id: 'claude-haiku-3-5', display_name: 'Claude Haiku 3.5', context_window: 200000 },
            ],
          });
        }
        if (url.endsWith('/v1/messages') && requests.at(-1)?.body?.stream === true) {
          return {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            bodyText: [
              'data: {"type":"content_block_delta","delta":{"text":"Hello "}}',
              '',
              'data: {"type":"content_block_delta","delta":{"text":"world"}}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
          };
        }
        if (url.endsWith('/v1/messages')) {
          const payload = requests.at(-1)?.body;
          assert.equal(payload.model, 'claude-sonnet-4-5');
          assert.equal(payload.max_tokens, 2048);
          assert.equal(payload.system, 'System prompt');
          assert.deepEqual(payload.messages, [
            { role: 'user', content: 'Say hello' },
            { role: 'assistant', content: 'Hello' },
          ]);
          return jsonResponse({
            content: [{ text: 'Hello world' }],
            usage: { input_tokens: 7, output_tokens: 3 },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
  );

  const completion = await provider.complete([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Say hello' },
    { role: 'assistant', content: 'Hello' },
  ], { model: 'claude-sonnet-4-5' });

  assert.equal(completion.content, 'Hello world');
  assert.equal(completion.provider, 'anthropic');
  assert.deepEqual(completion.usage, {
    promptTokens: 7,
    completionTokens: 3,
    totalTokens: 10,
  });

  const models = await provider.listModels();
  assert.deepEqual(models.map((model) => model.id), ['claude-sonnet-4-5', 'claude-haiku-3-5']);

  const chunks = await collectChunks(provider.stream([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Say hello' },
  ], { model: 'claude-sonnet-4-5' }));
  assert.deepEqual(chunks, ['Hello ', 'world']);

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  assert.ok(requests.some((request) => request.url.endsWith('/v1/models')));
});
