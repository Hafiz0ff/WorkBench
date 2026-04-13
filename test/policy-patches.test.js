import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTranslator } from '../src/i18n.js';
import { getDefaultPolicy, evaluatePathPolicy, evaluateCommandPolicy, writeProjectPolicy } from '../src/policy.js';
import { runShellCommand } from '../src/execution.js';
import { applyPatchArtifact, formatPatchDiff, getPendingPatch, rejectPatchArtifact, stageProjectFileChange, stageProjectPatch } from '../src/patches.js';
import { createTask } from '../src/tasks.js';
import { scaffoldBuiltInRoles } from '../src/roles.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-policy-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
    scripts: {
      test: 'node -e "process.exit(0)"',
    },
  }, null, 2));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await scaffoldBuiltInRoles(root);
  return root;
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

test('policy precedence blocks blocked paths and commands even when allowlists match', async () => {
  const root = await createTempProject();
  const policy = {
    ...getDefaultPolicy(),
    approvalMode: 'auto-safe',
    allowedWriteGlobs: ['**/*'],
    blockedPaths: ['src/blocked/**'],
    allowedCommands: ['rm -rf'],
    blockedCommands: ['rm', 'rm -rf'],
  };

  const pathDecision = evaluatePathPolicy(policy, 'src/blocked/file.js', 'write', root);
  const commandDecision = evaluateCommandPolicy(policy, 'rm', ['-rf', '.']);

  assert.equal(pathDecision.blocked, true);
  assert.equal(commandDecision.blocked, true);
});

test('blocked path rejection prevents patch staging', async () => {
  const root = await createTempProject();
  const policy = {
    ...getDefaultPolicy(),
    approvalMode: 'auto-safe',
    blockedPaths: ['src/secret/**'],
  };

  await assert.rejects(() => stageProjectFileChange(root, 'src/secret/file.js', 'secret', { policy }));
});

test('blocked command rejection is returned by the execution layer', async () => {
  const root = await createTempProject();
  const policy = getDefaultPolicy();
  const t = await createTranslator('ru');

  const result = await runShellCommand(root, 'rm', ['-rf', '.'], { policy, t });

  assert.equal(result.decision, 'blocked');
  assert.equal(result.ok, false);
  assert.match(result.message, /заблокирована|Blocked/i);
});

test('staging a file change creates a pending patch artifact and readable diff', async () => {
  const root = await createTempProject();
  const result = await stageProjectFileChange(root, 'src/index.js', 'export const value = 2;\n', {
    policy: {
      ...getDefaultPolicy(),
      approvalMode: 'auto-safe',
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.pending.status, 'pending');
  assert.equal(result.pending.taskId, null);

  const pending = await getPendingPatch(root);
  assert.ok(pending);
  const diff = formatPatchDiff(pending);
  assert.match(diff, /--- a\/src\/index\.js/);
  assert.match(diff, /\+ export const value = 2;/);
});

test('apply and reject lifecycle updates patch state and preserves file content on reject', async () => {
  const root = await createTempProject();
  const policy = {
    ...getDefaultPolicy(),
    approvalMode: 'auto-safe',
  };

  await stageProjectFileChange(root, 'src/index.js', 'export const value = 2;\n', { policy });
  const applied = await applyPatchArtifact(root, null, { policy });
  assert.equal(applied.applied, true);
  assert.match(await readText(path.join(root, 'src', 'index.js')), /value = 2/);

  await stageProjectFileChange(root, 'src/index.js', 'export const value = 3;\n', { policy });
  const rejected = await rejectPatchArtifact(root, null);
  assert.equal(rejected.rejected, true);
  assert.match(await readText(path.join(root, 'src', 'index.js')), /value = 2/);
});

test('approval mode changes path and command decisions', async () => {
  const root = await createTempProject();
  const onRequest = {
    ...getDefaultPolicy(),
    approvalMode: 'on-request',
  };
  const autoSafe = {
    ...getDefaultPolicy(),
    approvalMode: 'auto-safe',
  };

  assert.equal(evaluatePathPolicy(onRequest, 'src/index.js', 'write', root).approvalRequired, true);
  assert.equal(evaluatePathPolicy(autoSafe, 'src/index.js', 'write', root).allowed, true);
  assert.equal(evaluateCommandPolicy(onRequest, 'npm', ['test']).approvalRequired, true);
  assert.equal(evaluateCommandPolicy(autoSafe, 'npm', ['test']).allowed, true);
});

test('validation results are logged back into the current task notes after patch apply', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Validation flow',
    userRequest: 'Проверить логирование в notes',
    relevantFiles: ['src/index.js'],
  }, 'ru');

  await writeProjectPolicy(root, {
    ...getDefaultPolicy(),
    approvalMode: 'auto-safe',
  });

  await stageProjectPatch(root, {
    taskId: task.id,
    role: 'senior-engineer',
    model: 'qwen2.5-coder:14b',
    summary: 'Update the main export',
    validationCommands: [{ command: 'npm', args: ['test'] }],
    changes: [{
      path: 'src/index.js',
      action: 'update',
      afterContent: 'export const value = 2;\n',
    }],
  });

  const result = await execFileAsync(process.execPath, [CLI_PATH, 'patch', 'apply'], {
    cwd: root,
    env: { ...process.env },
    maxBuffer: 1024 * 1024,
  });

  assert.match(result.stdout.toString(), /проверка успешна/i);

  const notes = await readText(path.join(root, '.local-codex', 'tasks', 'active', task.id, 'notes.md'));
  assert.match(notes, /validation result/i);
  assert.match(notes, /npm test/i);
});
