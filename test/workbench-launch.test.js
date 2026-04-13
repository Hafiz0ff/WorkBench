import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkbenchInvocation } from '../src/workbench.js';

test('routes folder arguments to start mode', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['/Users/demo/project']), ['start', '/Users/demo/project']);
});

test('routes current directory to start mode when no args are provided', () => {
  assert.deepEqual(resolveWorkbenchInvocation([], '/Users/demo/project'), ['start', '/Users/demo/project']);
});

test('preserves explicit commands', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['roles', 'list']), ['roles', 'list']);
  assert.deepEqual(resolveWorkbenchInvocation(['project', 'status']), ['project', 'status']);
});

test('preserves option-only invocations', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['--help']), ['--help']);
});
