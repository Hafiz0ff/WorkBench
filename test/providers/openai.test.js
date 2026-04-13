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

test('openai provider streams chunks and lists models', async () => {
  const provider = createOpenAIProvider(
    {
      apiKey: 'sk-test',
      defaultModel: 'gpt-4o',
    },
    {
      client: {
        chat: {
          completions: {
            create: async () => (async function* () {
              yield { choices: [{ delta: { content: 'Hello ' } }] };
              yield { choices: [{ delta: { content: 'world' } }] };
            }()) ,
          },
        },
        models: {
          list: async () => ({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4-turbo' },
            ],
          }),
        },
      },
    },
  );

  const models = await provider.listModels();
  assert.deepEqual(models, ['gpt-4o', 'gpt-4-turbo']);

  const chunks = await collectChunks(provider.chat([
    { role: 'user', content: 'Say hello' },
  ], { model: 'gpt-4o' }));

  assert.deepEqual(chunks, ['Hello ', 'world']);
  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
});
