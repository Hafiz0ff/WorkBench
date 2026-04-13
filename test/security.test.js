import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinRoot, resolveWithinRoot } from '../src/security.js';

test('resolveWithinRoot keeps relative paths inside root', () => {
  const resolved = resolveWithinRoot('/tmp/project', 'src/index.js');
  assert.equal(resolved, '/tmp/project/src/index.js');
});

test('resolveWithinRoot rejects parent traversal', () => {
  assert.throws(() => resolveWithinRoot('/tmp/project', '../escape.txt'));
});

test('resolveWithinRoot rejects absolute escape paths', () => {
  assert.throws(() => resolveWithinRoot('/tmp/project', '/etc/passwd'));
});

test('isWithinRoot returns true only for safe paths', () => {
  assert.equal(isWithinRoot('/tmp/project', 'src/../README.md'), true);
  assert.equal(isWithinRoot('/tmp/project', '../../README.md'), false);
});
