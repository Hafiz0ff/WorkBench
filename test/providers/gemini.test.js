import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider as createGeminiProvider } from '../../src/providers/gemini.js';

async function collectChunks(iterator) {
  const chunks = [];
  for await (const chunk of iterator) {
    chunks.push(chunk);
  }
  return chunks;
}

test('gemini provider streams chunks and lists models', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/v1beta/models')) {
      return new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-2.0-flash' },
          { name: 'models/gemini-1.5-pro' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const provider = createGeminiProvider(
      {
        apiKey: 'gemini-test',
        defaultModel: 'gemini-2.0-flash',
      },
      {
        client: {
          models: {
            generateContentStream: async () => (async function* () {
              yield { text: 'Hello ' };
              yield { text: 'world' };
            }()),
          },
        },
      },
    );

    const models = await provider.listModels();
    assert.deepEqual(models, ['models/gemini-2.0-flash', 'models/gemini-1.5-pro']);

    const chunks = await collectChunks(provider.chat([
      { role: 'user', content: 'Say hello' },
    ], { model: 'gemini-2.0-flash' }));

    assert.deepEqual(chunks, ['Hello ', 'world']);
    const health = await provider.healthCheck();
    assert.equal(health.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});
