import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  detectRunner,
  getHistory,
  getTestRunnerConfig,
  parseTestRunFailures,
  parseTestRunSummary,
  pruneHistory,
  runTests,
} from '../src/test-runner.js';
import { getDefaultPolicy, writeProjectPolicy } from '../src/policy.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-test-runner-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return root;
}

test('detectRunner finds common project test commands', async () => {
  const root = await createTempProject();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
    scripts: { test: 'node --test' },
  }, null, 2));
  const nodeDetected = await detectRunner(root);
  assert.equal(nodeDetected.name, 'node');
  assert.equal(nodeDetected.command, 'node --test');

  const pytestRoot = await createTempProject();
  await writeFile(path.join(pytestRoot, 'pytest.ini'), '[pytest]\n');
  const pytestDetected = await detectRunner(pytestRoot);
  assert.equal(pytestDetected.name, 'pytest');
  assert.equal(pytestDetected.command, 'pytest');
});

test('parseTestRunSummary handles the supported runner styles', async () => {
  const jestSummary = parseTestRunSummary('Tests:       5 passed, 0 failed, 5 total', 'jest', 0);
  assert.equal(jestSummary.passed, 5);

  const shellSummary = parseTestRunSummary('1 passed, 0 failed', 'shell', 0);
  assert.equal(shellSummary.passed, 1);
  assert.equal(shellSummary.failed, 0);
  assert.equal(shellSummary.total, 1);

  const pytestSummary = parseTestRunSummary('============================= test session starts =============================\n2 passed, 1 skipped in 0.12s', 'pytest', 0);
  assert.equal(pytestSummary.passed, 2);
  assert.equal(pytestSummary.skipped, 1);
  assert.equal(pytestSummary.total, 3);

  const swiftSummary = parseTestRunSummary('Executed 7 tests, with 1 failures', 'swift', 1);
  assert.equal(swiftSummary.total, 7);
  assert.equal(swiftSummary.passed, 6);
  assert.equal(swiftSummary.failed, 1);

  const cargoSummary = parseTestRunSummary('ok   mypkg  4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out', 'cargo', 0);
  assert.equal(cargoSummary.total, 4);
  assert.equal(cargoSummary.passed, 4);
  assert.equal(cargoSummary.failed ?? 0, 0);
  assert.equal(cargoSummary.skipped ?? 0, 0);
  assert.deepEqual(parseTestRunFailures('--- FAIL: auth middleware should reject invalid token\npanic: boom'), [
    {
      name: 'auth middleware should reject invalid token',
      error: 'panic: boom',
    },
  ]);
});

test('runTests records history and pruneHistory keeps the newest entries', async () => {
  const root = await createTempProject();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProjectPolicy(root, {
    ...getDefaultPolicy(),
    testRunner: {
      command: 'node -e "console.log(\'1 passed, 0 failed\')"',
      timeout: 5000,
      autoRun: {
        onPatchApply: true,
        onAutoStep: true,
      },
      onFail: {
        action: 'warn',
        rollbackPatches: true,
      },
      history: {
        keepLast: 2,
      },
      runners: [],
      env: {},
    },
  });

  const first = await runTests({ projectRoot: root, allowApprovalBypass: true });
  const second = await runTests({ projectRoot: root, allowApprovalBypass: true });
  assert.equal(first.status, 'passed');
  assert.equal(second.status, 'passed');

  const history = await getHistory(root, { limit: 10 });
  assert.equal(history.length, 2);
  assert.match(history[0].runId, /^testrun-/);

  const pruned = await pruneHistory(root, 1);
  assert.equal(pruned.pruned, 1);
  const remaining = await getHistory(root, { limit: 10 });
  assert.equal(remaining.length, 1);
  const logPath = path.join(root, '.local-codex', 'test-runs', `${remaining[0].runId}.log`);
  const log = await readFile(logPath, 'utf8');
  assert.match(log, /1 passed, 0 failed/);
});

test('getTestRunnerConfig accepts an in-memory policy object', async () => {
  const config = await getTestRunnerConfig({
    testRunner: {
      command: 'npm test',
      timeout: 1234,
      autoRun: {
        onPatchApply: false,
      },
      onFail: {
        action: 'rollback',
      },
      history: {
        keepLast: 17,
      },
      runners: [{ name: 'unit', command: 'npm run test:unit', runOrder: 1 }],
    },
  });

  assert.equal(config.command, 'npm test');
  assert.equal(config.timeout, 1234);
  assert.equal(config.autoRun.onPatchApply, false);
  assert.equal(config.onFail.action, 'rollback');
  assert.equal(config.history.keepLast, 17);
  assert.equal(config.runners.length, 1);
});
