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

test('anthropic provider streams chunks and lists models', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/v1/models')) {
      return new Response(JSON.stringify({
        data: [
          { id: 'claude-3-5-sonnet-20241022' },
          { id: 'claude-3-haiku-20240307' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const provider = createAnthropicProvider(
      {
        apiKey: 'anthropic-test',
        defaultModel: 'claude-3-5-sonnet-20241022',
      },
      {
        client: {
          messages: {
            stream: () => {
              let textHandler = null;
              return {
                on(event, handler) {
                  if (event === 'text') {
                    textHandler = handler;
                  }
                },
                async finalMessage() {
                  textHandler?.('Hello ');
                  textHandler?.('world');
                  return {};
                },
              };
            },
          },
        },
      },
    );

    const models = await provider.listModels();
    assert.deepEqual(models, ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']);

    const chunks = await collectChunks(provider.chat([
      { role: 'user', content: 'Say hello' },
    ], { model: 'claude-3-5-sonnet-20241022' }));

    assert.deepEqual(chunks, ['Hello ', 'world']);
    const health = await provider.healthCheck();
    assert.equal(health.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});
