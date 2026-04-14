import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, requestRaw, requestSSE } from '../../src/providers/http.js';

test('http helper retries retryable responses and parses JSON', async () => {
  let attempts = 0;
  const result = await requestJson('https://example.test/chat', {
    method: 'POST',
    maxRetries: 1,
    body: JSON.stringify({ test: true }),
  }, {
    requestImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 429,
          headers: { 'retry-after': '0.001' },
          bodyText: 'rate limited',
        };
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ ok: true }),
      };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result.json, { ok: true });
});

test('http helper parses SSE bodies', async () => {
  const events = [];
  await requestSSE('https://example.test/stream', {
    method: 'POST',
    maxRetries: 0,
  }, {
    requestImpl: async () => ({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyText: [
        'event: update',
        'data: {"ok":true}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    }),
  }, (event) => events.push(event));

  assert.deepEqual(events, [{ event: 'update', data: '{"ok":true}' }]);
});

test('http helper exposes raw responses', async () => {
  const response = await requestRaw('https://example.test/raw', {
    method: 'GET',
    maxRetries: 0,
  }, {
    requestImpl: async () => ({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      bodyText: 'raw-body',
    }),
  });

  assert.equal(response.bodyText, 'raw-body');
  assert.equal(response.status, 200);
});
