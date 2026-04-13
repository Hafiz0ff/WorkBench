import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkbenchInvocation } from '../src/workbench.js';

test('routes folder arguments to start mode', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['/Users/demo/project']), ['start', '/Users/demo/project']);
});

test('routes folder plus task text to start mode with task flag', () => {
  assert.deepEqual(
    resolveWorkbenchInvocation(['/Users/demo/project', 'Implement auth flow']),
    ['start', '/Users/demo/project', '--task', 'Implement auth flow'],
  );
});

test('routes current directory to workspace switch mode when no args are provided', () => {
  assert.deepEqual(resolveWorkbenchInvocation([], '/Users/demo/project'), ['workspace', 'switch']);
});

test('preserves explicit commands', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['roles', 'list']), ['roles', 'list']);
  assert.deepEqual(resolveWorkbenchInvocation(['project', 'status']), ['project', 'status']);
});

test('preserves option-only invocations', () => {
  assert.deepEqual(resolveWorkbenchInvocation(['--help']), ['--help']);
});
