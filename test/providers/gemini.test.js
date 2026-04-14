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

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bodyText: JSON.stringify(body),
  };
}

test('gemini provider converts roles, streams chunks and lists models', async () => {
  const requests = [];
  const provider = createGeminiProvider(
    {
      apiKey: 'gemini-test',
      defaultModel: 'gemini-2.5-flash',
      maxTokens: 2048,
    },
    {
      requestImpl: async ({ url, method, body }) => {
        requests.push({ url, method, body: body ? JSON.parse(body) : null });
        if (String(url).includes('/v1beta/models?')) {
          return jsonResponse({
            models: [
              { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1000000 },
              { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', inputTokenLimit: 1000000 },
            ],
          });
        }
        if (String(url).includes(':streamGenerateContent')) {
          return {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            bodyText: [
              'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}',
              '',
              'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
          };
        }
        if (String(url).includes(':generateContent')) {
          const payload = requests.at(-1)?.body;
          assert.equal(payload.systemInstruction.parts[0].text, 'System prompt');
          assert.deepEqual(payload.contents, [
            { role: 'user', parts: [{ text: 'First' }, { text: 'Second' }] },
            { role: 'model', parts: [{ text: 'Assistant' }] },
          ]);
          return jsonResponse({
            candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
  );

  const completion = await provider.complete([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'First' },
    { role: 'user', content: 'Second' },
    { role: 'assistant', content: 'Assistant' },
  ], { model: 'gemini-2.5-flash' });

  assert.equal(completion.content, 'Hello world');
  assert.equal(completion.provider, 'gemini');
  assert.deepEqual(completion.usage, {
    promptTokens: 11,
    completionTokens: 4,
    totalTokens: 15,
  });

  const models = await provider.listModels();
  assert.deepEqual(models.map((model) => model.id), ['gemini-2.5-flash', 'gemini-2.0-flash']);

  const chunks = await collectChunks(provider.stream([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Say hello' },
  ], { model: 'gemini-2.5-flash' }));
  assert.deepEqual(chunks, ['Hello ', 'world']);

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
});
