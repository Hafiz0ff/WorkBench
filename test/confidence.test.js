import test from 'node:test';
import assert from 'node:assert/strict';
import { confidenceFromRaw, confidenceClass, confidenceLabel } from '../src/confidence.js';

test('confidence helper converts logprobs into scores and labels', async () => {
  const result = confidenceFromRaw({
    choices: [{
      logprobs: {
        content: [
          { token: 'Hello', logprob: -0.05 },
          { token: 'world', logprob: -0.12 },
        ],
      },
    }],
  });

  assert.ok(result);
  assert.equal(result.source, 'logprobs');
  assert.equal(result.tokenCount, 2);
  assert.equal(confidenceClass(result.score), 'confidence-high');
  assert.equal(confidenceLabel(result.score), 'High confidence');
  assert.equal(result.percent, Math.round(result.score * 100));
});

test('confidence helper returns null when logprobs are absent', async () => {
  assert.equal(confidenceFromRaw({ choices: [{ message: { content: 'hello' } }] }), null);
});
