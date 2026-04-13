import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { evaluatePathPolicy, readProjectPolicy } from './policy.js';
import { runConfiguredTests, getTestRunnerConfig, detectRunner } from './test-runner.js';

const PATCHES_DIR_NAME = path.join('.local-codex', 'patches');
const PENDING_PATCH_FILE = path.join('.local-codex', 'pending-change.json');
const PATCH_SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.writeFile(tempPath, content, encoding).then(() => fs.rename(tempPath, filePath));
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

function normalizeRelativeEditPath(projectRoot, relativePath) {
  const root = normalizeRoot(projectRoot);
  const absolute = resolveWithinRoot(root, relativePath);
  return path.relative(root, absolute);
}

function toPosixPath(value) {
  return String(value).replaceAll(path.sep, '/');
}

function splitLines(text) {
  if (!text) {
    return [];
  }
  return String(text).replace(/\r\n/g, '\n').split('\n');
}

function escapeText(value) {
  return String(value).replace(/\0/g, '\\0');
}

function fallbackDiff(before, after) {
  return [
    '@@',
    ...splitLines(before).map((line) => `- ${line}`),
    ...splitLines(after).map((line) => `+ ${line}`),
  ].join('\n');
}

function buildLineDiff(beforeText, afterText) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const beforeCount = beforeLines.length;
  const afterCount = afterLines.length;

  if (beforeCount === 0 && afterCount === 0) {
    return '';
  }

  if (beforeCount * afterCount > 40000) {
    return fallbackDiff(beforeText, afterText);
  }

  const dp = Array.from({ length: beforeCount + 1 }, () => new Array(afterCount + 1).fill(0));
  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < beforeCount && j < afterCount) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: 'context', line: beforeLines[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', line: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', line: afterLines[j] });
      j += 1;
    }
  }
  while (i < beforeCount) {
    ops.push({ type: 'remove', line: beforeLines[i] });
    i += 1;
  }
  while (j < afterCount) {
    ops.push({ type: 'add', line: afterLines[j] });
    j += 1;
  }

  return ops.map((op) => {
    if (op.type === 'context') {
      return `  ${op.line}`;
    }
    if (op.type === 'add') {
      return `+ ${op.line}`;
    }
    return `- ${op.line}`;
  }).join('\n');
}

function buildFileDiff(change) {
  const header = [
    `--- a/${change.path}`,
    `+++ b/${change.path}`,
  ];

  if (change.action === 'create') {
    return [
      ...header,
      '@@ CREATE @@',
      ...splitLines(change.afterContent).map((line) => `+ ${line}`),
    ].join('\n');
  }

  if (change.action === 'delete') {
    return [
      ...header,
      '@@ DELETE @@',
      ...splitLines(change.beforeContent).map((line) => `- ${line}`),
    ].join('\n');
  }

  const diff = buildLineDiff(change.beforeContent, change.afterContent);
  return [
    ...header,
    '@@ UPDATE @@',
    diff || '  (no textual changes)',
  ].join('\n');
}

function buildPatchId(label = 'patch') {
  const timestamp = nowIso().replace(/[:.]/g, '-');
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${label}-${timestamp}-${suffix}`;
}

function normalizeChangeInput(projectRoot, change) {
  if (!change || typeof change !== 'object') {
    throw new Error('Invalid change object.');
  }
  const action = String(change.action || 'update').trim().toLowerCase();
  if (!['create', 'update', 'delete'].includes(action)) {
    throw new Error(`Invalid change action: ${action}`);
  }
  const relativePath = normalizeRelativeEditPath(projectRoot, change.path);
  return {
    action,
    path: toPosixPath(relativePath),
    beforeContent: typeof change.beforeContent === 'string' ? change.beforeContent : '',
    afterContent: typeof change.afterContent === 'string' ? change.afterContent : '',
  };
}

async function suggestValidationCommands(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const candidates = [];
  const packageJsonPath = path.join(root, 'package.json');
  const hasPackageJson = await fileExists(packageJsonPath);
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(await readTextFile(packageJsonPath));
      const scripts = pkg.scripts || {};
      if (scripts.test) {
        candidates.push({ command: 'npm', args: ['test'] });
      }
      if (scripts.lint) {
        candidates.push({ command: 'npm', args: ['run', 'lint'] });
      }
      if (scripts.format) {
        candidates.push({ command: 'npm', args: ['run', 'format'] });
      }
    } catch {
      // Ignore invalid package.json here; validation is optional.
    }
  }

  const pythonIndicators = ['pytest.ini', 'pyproject.toml', 'setup.py'];
  for (const indicator of pythonIndicators) {
    if (await fileExists(path.join(root, indicator))) {
      candidates.push({ command: 'pytest', args: [] });
      break;
    }
  }

  return candidates;
}

async function readPendingPatch(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const filePath = path.join(root, PENDING_PATCH_FILE);
  if (!(await fileExists(filePath))) {
    return null;
  }
  try {
    return JSON.parse(await readTextFile(filePath));
  } catch {
    return null;
  }
}

async function writePendingPatch(projectRoot, patch) {
  const root = normalizeRoot(projectRoot);
  await ensureDirectory(path.join(root, '.local-codex'));
  const filePath = path.join(root, PENDING_PATCH_FILE);
  await atomicWriteFile(filePath, `${JSON.stringify(patch, null, 2)}\n`);
  return filePath;
}

async function writePatchArtifact(projectRoot, patch) {
  const root = normalizeRoot(projectRoot);
  const patchRoot = path.join(root, PATCHES_DIR_NAME, patch.patchId);
  await ensureDirectory(patchRoot);
  const patchPath = path.join(patchRoot, 'patch.json');
  const diffPath = path.join(patchRoot, 'diff.txt');
  await atomicWriteFile(patchPath, `${JSON.stringify(patch, null, 2)}\n`);
  await atomicWriteFile(diffPath, `${patch.diffText}\n`);
  return { patchPath, diffPath, patchRoot };
}

async function readPatchArtifact(projectRoot, patchId) {
  const root = normalizeRoot(projectRoot);
  const patchPath = path.join(root, PATCHES_DIR_NAME, patchId, 'patch.json');
  if (!(await fileExists(patchPath))) {
    return null;
  }
  try {
    return JSON.parse(await readTextFile(patchPath));
  } catch {
    return null;
  }
}

function summarizeChanges(changes) {
  return changes.map((change) => `${change.action}: ${change.path}`).join(', ');
}

function buildApprovalStatus(policyDecision) {
  if (policyDecision.blocked) {
    return 'blocked';
  }
  return policyDecision.approvalRequired ? 'required' : 'not_required';
}

function summarizeApprovalStatus(changes) {
  if (changes.some((change) => buildApprovalStatus(change.policyDecision) === 'blocked')) {
    return 'blocked';
  }
  if (changes.some((change) => buildApprovalStatus(change.policyDecision) === 'required')) {
    return 'required';
  }
  return 'not_required';
}

function normalizeValidationResult(result) {
  return {
    runId: result.runId || null,
    command: result.command || '',
    args: Array.isArray(result.args) ? result.args : [],
    ok: result.status === 'passed',
    skipped: Boolean(result.skipped),
    status: result.status || (result.skipped ? 'skipped' : 'failed'),
    code: result.exitCode,
    stdout: result.output || '',
    stderr: result.stderr || '',
    reason: result.reason || null,
    duration: result.duration || 0,
    summary: result.summary || null,
    failedTests: Array.isArray(result.failedTests) ? result.failedTests : [],
    message: result.reason || result.status || null,
  };
}

function summarizeValidationStatus(validationResults) {
  const executedResults = validationResults.filter((result) => !result.skipped);
  if (!validationResults.length || !executedResults.length) {
    return 'skipped';
  }
  return executedResults.every((result) => result.ok) ? 'success' : 'failed';
}

async function runPatchTestSuite(projectRoot, patch, options = {}) {
  if (options.skipTests) {
    return [];
  }
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const testRunner = getTestRunnerConfig(policy);
  if (testRunner.autoRun?.onPatchApply === false) {
    return [];
  }

  const commands = Array.isArray(patch.validationCommands) && patch.validationCommands.length
    ? patch.validationCommands
    : [];
  const fallbackCommand = testRunner.runners?.length
    ? testRunner.runners
    : (testRunner.command ? [{ command: testRunner.command, cwd: testRunner.cwd, timeout: testRunner.timeout }] : []);
  const suite = commands.length ? commands : fallbackCommand.length ? fallbackCommand : [await detectRunner(projectRoot)];
  const results = [];
  const stopOnFailure = testRunner.onFail?.action === 'rollback' || String(policy.approvalMode || '').trim().toLowerCase() === 'auto-with-tests';
  for (const command of suite) {
    const runResult = await runConfiguredTests(projectRoot, {
      policy,
      commands: [command],
      taskId: patch.taskId || null,
      patchId: patch.patchId || null,
      allowApprovalBypass: true,
      stopOnFailure,
      onlyAuto: false,
    });
    results.push(...runResult.map(normalizeValidationResult));
    if (stopOnFailure && results.some((result) => result.status !== 'passed')) {
      break;
    }
  }
  return results;
}

async function handlePatchFailureOutcome(projectRoot, patch, validationResults, options = {}) {
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const testRunner = getTestRunnerConfig(policy);
  const status = summarizeValidationStatus(validationResults);
  const failed = status === 'failed';
  if (!failed) {
    return {
      action: 'continue',
      rolledBack: false,
      validationStatus: status,
    };
  }

  const approvalMode = String(policy.approvalMode || '').trim().toLowerCase();
  const autoWithTests = approvalMode === 'auto-with-tests';
  const action = autoWithTests ? 'rollback' : testRunner.onFail?.action || 'warn';

  if (action === 'warn') {
    return {
      action,
      rolledBack: false,
      validationStatus: status,
    };
  }

  if (action === 'ask') {
    const promptApproval = typeof options.promptApproval === 'function'
      ? options.promptApproval
      : null;
    if (promptApproval) {
      const approved = await promptApproval();
      if (approved) {
        const rolledBack = await rollbackPatch(projectRoot, patch);
        return {
          action: 'rollback',
          rolledBack: rolledBack.rolledBack,
          validationStatus: status,
          patch: rolledBack.patch || patch,
        };
      }
    }
  }

  if (testRunner.onFail?.rollbackPatches !== false) {
    const rolledBack = await rollbackPatch(projectRoot, patch);
    return {
      action: 'rollback',
      rolledBack: rolledBack.rolledBack,
      validationStatus: status,
      patch: rolledBack.patch || patch,
    };
  }

  return {
    action: 'warn',
    rolledBack: false,
    validationStatus: status,
  };
}

export async function ensurePatchWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureDirectory(path.join(root, PATCHES_DIR_NAME));
  return {
    patchRoot: path.join(root, PATCHES_DIR_NAME),
    pendingPatchPath: path.join(root, PENDING_PATCH_FILE),
  };
}

export async function stageProjectPatch(projectRoot, input = {}) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const policy = input.policy || await readProjectPolicy(root);
  const changeInputs = Array.isArray(input.changes) ? input.changes : [];
  if (!changeInputs.length) {
    throw new Error('No file changes were provided.');
  }

  const normalizedChanges = [];
  for (const changeInput of changeInputs) {
    const normalized = normalizeChangeInput(root, changeInput);
    const pathDecision = evaluatePathPolicy(policy, normalized.path, 'write', root);
    if (pathDecision.blocked) {
      throw new Error(pathDecision.reason);
    }
    const absolutePath = resolveWithinRoot(root, normalized.path);
    const exists = await fileExists(absolutePath);
    const currentContent = exists ? await readTextFile(absolutePath) : '';
    if (normalized.action === 'create' && exists) {
      throw new Error(`File already exists: ${normalized.path}`);
    }
    if (normalized.action === 'delete' && !exists) {
      throw new Error(`File does not exist: ${normalized.path}`);
    }
    normalized.beforeContent = normalized.action === 'create' ? '' : currentContent;
    normalized.afterContent = normalized.action === 'delete' ? '' : normalized.afterContent;
    if (normalized.action === 'update' && normalized.afterContent === currentContent) {
      continue;
    }
    if (normalized.action === 'create' && normalized.afterContent === currentContent) {
      continue;
    }
    normalized.policyDecision = pathDecision;
    normalizedChanges.push(normalized);
  }

  if (!normalizedChanges.length) {
    return {
      pending: null,
      changed: false,
      summary: 'No textual changes were detected.',
    };
  }

  const patchId = buildPatchId(input.taskId || 'patch');
  const patch = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId,
    status: 'pending',
    taskId: input.taskId || null,
    role: input.role || null,
    model: input.model || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    approvalMode: policy.approvalMode,
    approvalStatus: summarizeApprovalStatus(normalizedChanges),
    validationStatus: 'pending',
    summary: String(input.summary || summarizeChanges(normalizedChanges)).trim(),
    affectedFiles: normalizedChanges.map((change) => ({
      path: change.path,
      action: change.action,
      approval: buildApprovalStatus(change.policyDecision),
    })),
    validationCommands: Array.isArray(input.validationCommands) && input.validationCommands.length
      ? input.validationCommands
      : await suggestValidationCommands(root),
    changes: normalizedChanges.map((change) => ({
      path: change.path,
      action: change.action,
      beforeContent: change.beforeContent,
      afterContent: change.afterContent,
      diffText: buildFileDiff(change),
    })),
  };

  patch.diffText = patch.changes.map((change) => change.diffText).join('\n\n');
  patch.validationStatus = patch.validationCommands.length ? 'pending' : 'skipped';

  const { patchPath, diffPath } = await writePatchArtifact(root, patch);
  const pending = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: patch.patchId,
    taskId: patch.taskId,
    role: patch.role,
    model: patch.model,
    createdAt: patch.createdAt,
    updatedAt: patch.updatedAt,
    status: patch.status,
    approvalMode: patch.approvalMode,
    approvalStatus: patch.approvalStatus,
    validationStatus: patch.validationStatus,
    summary: patch.summary,
    affectedFiles: patch.affectedFiles,
    validationCommands: patch.validationCommands,
    diffPath: toPosixPath(path.relative(root, diffPath)),
    patchPath: toPosixPath(path.relative(root, patchPath)),
  };
  await writePendingPatch(root, pending);

  return {
    pending,
    patch,
    changed: true,
  };
}

export async function stageProjectFileChange(projectRoot, relativePath, content, options = {}) {
  const root = normalizeRoot(projectRoot);
  const absolute = resolveWithinRoot(root, relativePath);
  const exists = await fileExists(absolute);
  return stageProjectPatch(root, {
    ...options,
    changes: [{
      path: path.relative(root, absolute),
      action: exists ? 'update' : 'create',
      afterContent: content,
    }],
  });
}

export async function deleteProjectFile(projectRoot, relativePath, options = {}) {
  const root = normalizeRoot(projectRoot);
  return stageProjectPatch(root, {
    ...options,
    changes: [{
      path: relativePath,
      action: 'delete',
    }],
  });
}

export async function getLatestPatch(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const pending = await readPendingPatch(root);
  if (!pending) {
    return null;
  }
  const artifact = await readPatchArtifact(root, pending.patchId);
  return artifact || pending;
}

export async function getPendingPatch(projectRoot, selector = null) {
  const latest = await getLatestPatch(projectRoot);
  if (!latest || latest.status !== 'pending') {
    return null;
  }
  if (selector && selector.taskId && latest.taskId !== selector.taskId) {
    return null;
  }
  return latest;
}

export function formatPatchDiff(patch) {
  if (!patch) {
    return '';
  }
  return patch.changes.map((change) => buildFileDiff(change)).join('\n\n');
}

export function formatPatchStatus(patch, t) {
  if (!patch) {
    return t ? t('patch.noPending') : 'No pending patch.';
  }
  const statusLabel = {
    pending: t ? t('patch.statusPending') : 'pending',
    applied: t ? t('patch.statusApplied') : 'applied',
    rejected: t ? t('patch.statusRejected') : 'rejected',
    conflict: t ? t('patch.statusConflict') : 'conflict',
  }[patch.status] || patch.status;
  const approvalLabel = patch.approvalStatus === 'required'
    ? (t ? t('patch.approvalRequired') : 'Approval required')
    : patch.approvalStatus === 'blocked'
      ? (t ? t('patch.approvalBlocked') : 'Blocked')
      : (t ? t('patch.approvalNotRequired') : 'Not required');
  const validationLabel = patch.validationStatus === 'success'
    ? (t ? t('patch.validationSuccess') : 'Validation succeeded')
    : patch.validationStatus === 'failed'
      ? (t ? t('patch.validationFailed') : 'Validation failed')
      : patch.validationStatus === 'skipped'
        ? (t ? t('patch.validationSkipped') : 'Validation skipped')
        : (t ? t('patch.validationPending') : 'Validation pending');

  const files = patch.affectedFiles.length
    ? patch.affectedFiles.map((file) => `- ${file.action}: ${file.path} (${file.approval})`).join('\n')
    : `- ${t ? t('patch.noFiles') : 'No files'}`;

  return [
    `${t ? t('patch.statusTitle') : 'Patch status'}`,
    `${t ? t('common.currentTask') : 'Task'}: ${patch.taskId || (t ? t('common.notSet') : 'not set')}`,
    `${t ? t('patch.status') : 'Status'}: ${statusLabel}`,
    `${t ? t('policy.approvalModeLabel', { mode: t(`policy.approvalMode.${patch.approvalMode}`) }) : 'Approval mode'}`,
    `${t ? t('patch.approvalStatus') : 'Approval'}: ${approvalLabel}`,
    `${t ? t('patch.validationStatus') : 'Validation'}: ${validationLabel}`,
    `${t ? t('patch.summary') : 'Summary'}: ${patch.summary}`,
    `${t ? t('patch.files') : 'Files'}:`,
    files,
    '',
    `${t ? t('patch.diffTitle') : 'Diff'}:`,
    patch.diffText || (t ? t('patch.diffEmpty') : 'No diff'),
  ].join('\n');
}

export async function applyPatchArtifact(projectRoot, patch = null, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const current = patch || await getPendingPatch(root);
  if (!current) {
    return {
      applied: false,
      reason: 'no_pending_patch',
      patch: null,
      validationResults: [],
    };
  }

  const artifact = await readPatchArtifact(root, current.patchId) || current;
  if (artifact.status !== 'pending') {
    return {
      applied: false,
      reason: `patch_not_pending:${artifact.status}`,
      patch: artifact,
      validationResults: [],
    };
  }

  for (const change of artifact.changes) {
    const absolutePath = resolveWithinRoot(root, change.path);
    const exists = await fileExists(absolutePath);
    const currentContent = exists ? await readTextFile(absolutePath) : '';

    if (change.action === 'create') {
      if (exists) {
        throw new Error(`Patch conflict: file already exists: ${change.path}`);
      }
      continue;
    }

    if (change.action === 'delete') {
      if (!exists) {
        throw new Error(`Patch conflict: file missing: ${change.path}`);
      }
      if (currentContent !== change.beforeContent) {
        throw new Error(`Patch conflict: file changed since patch creation: ${change.path}`);
      }
      continue;
    }

    if (currentContent !== change.beforeContent) {
      throw new Error(`Patch conflict: file changed since patch creation: ${change.path}`);
    }
  }

  for (const change of artifact.changes) {
    const absolutePath = resolveWithinRoot(root, change.path);
    await ensureDirectory(path.dirname(absolutePath));
    if (change.action === 'delete') {
      await fs.rm(absolutePath, { force: true });
      continue;
    }
    await atomicWriteFile(absolutePath, change.afterContent);
  }

  const validationResults = await runPatchTestSuite(root, artifact, {
    policy: options.policy,
    skipTests: options.skipTests,
  });
  const validationStatus = summarizeValidationStatus(validationResults);
  const testOutcome = await handlePatchFailureOutcome(root, artifact, validationResults, {
    policy: options.policy,
    promptApproval: options.promptApproval,
  });
  const finalPatch = testOutcome.rolledBack ? testOutcome.patch : artifact;
  const nextPatch = {
    ...finalPatch,
    status: testOutcome.rolledBack ? 'rolled_back' : 'applied',
    updatedAt: nowIso(),
    appliedAt: nowIso(),
    validationStatus,
    validationResults,
  };
  const artifactPath = path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'patch.json');
  await atomicWriteFile(artifactPath, `${JSON.stringify(nextPatch, null, 2)}\n`);

  const pending = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: nextPatch.patchId,
    taskId: nextPatch.taskId,
    role: nextPatch.role,
    model: nextPatch.model,
    createdAt: nextPatch.createdAt,
    updatedAt: nextPatch.updatedAt,
    status: nextPatch.status,
    approvalMode: nextPatch.approvalMode,
    approvalStatus: nextPatch.approvalStatus,
    validationStatus: nextPatch.validationStatus,
    summary: nextPatch.summary,
    affectedFiles: nextPatch.affectedFiles,
    validationCommands: nextPatch.validationCommands,
    validationResults,
    appliedAt: nextPatch.appliedAt,
    diffPath: path.relative(root, path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'diff.txt')),
    patchPath: path.relative(root, artifactPath),
  };
  await writePendingPatch(root, pending);

  return {
    applied: !testOutcome.rolledBack,
    reason: testOutcome.rolledBack ? 'tests_failed_rollback' : null,
    patch: nextPatch,
    validationResults,
    testOutcome,
  };
}

export async function applyPatchSilent(projectRoot, patch = null, options = {}) {
  return applyPatchArtifact(projectRoot, patch, options);
}

export async function rejectPatchArtifact(projectRoot, patch = null) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const current = patch || await getPendingPatch(root);
  if (!current) {
    return {
      rejected: false,
      reason: 'no_pending_patch',
      patch: null,
    };
  }

  const artifact = await readPatchArtifact(root, current.patchId) || current;
  const nextPatch = {
    ...artifact,
    status: 'rejected',
    updatedAt: nowIso(),
    rejectedAt: nowIso(),
  };
  const artifactPath = path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'patch.json');
  await atomicWriteFile(artifactPath, `${JSON.stringify(nextPatch, null, 2)}\n`);

  const pending = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: nextPatch.patchId,
    taskId: nextPatch.taskId,
    role: nextPatch.role,
    model: nextPatch.model,
    createdAt: nextPatch.createdAt,
    updatedAt: nextPatch.updatedAt,
    status: nextPatch.status,
    approvalMode: nextPatch.approvalMode,
    approvalStatus: nextPatch.approvalStatus,
    validationStatus: nextPatch.validationStatus,
    summary: nextPatch.summary,
    affectedFiles: nextPatch.affectedFiles,
    validationCommands: nextPatch.validationCommands,
    rejectedAt: nextPatch.rejectedAt,
    diffPath: path.relative(root, path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'diff.txt')),
    patchPath: path.relative(root, artifactPath),
  };
  await writePendingPatch(root, pending);

  return {
    rejected: true,
    reason: null,
    patch: nextPatch,
  };
}

export async function rollbackPatch(projectRoot, patch = null) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const current = patch || await getLatestPatch(root);
  if (!current) {
    return {
      rolledBack: false,
      reason: 'no_patch',
      patch: null,
    };
  }

  const artifact = await readPatchArtifact(root, current.patchId) || current;
  const changes = Array.isArray(artifact.changes) ? [...artifact.changes].reverse() : [];
  for (const change of changes) {
    const absolutePath = resolveWithinRoot(root, change.path);
    const exists = await fileExists(absolutePath);
    if (change.action === 'create') {
      if (exists) {
        await fs.rm(absolutePath, { force: true });
      }
      continue;
    }
    if (change.action === 'delete') {
      await ensureDirectory(path.dirname(absolutePath));
      await atomicWriteFile(absolutePath, change.beforeContent || '');
      continue;
    }
    await ensureDirectory(path.dirname(absolutePath));
    await atomicWriteFile(absolutePath, change.beforeContent || '');
  }

  const nextPatch = {
    ...artifact,
    status: 'rolled_back',
    updatedAt: nowIso(),
    rolledBackAt: nowIso(),
  };
  const artifactPath = path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'patch.json');
  await atomicWriteFile(artifactPath, `${JSON.stringify(nextPatch, null, 2)}\n`);
  const pending = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: nextPatch.patchId,
    taskId: nextPatch.taskId,
    role: nextPatch.role,
    model: nextPatch.model,
    createdAt: nextPatch.createdAt,
    updatedAt: nextPatch.updatedAt,
    status: nextPatch.status,
    approvalMode: nextPatch.approvalMode,
    approvalStatus: nextPatch.approvalStatus,
    validationStatus: nextPatch.validationStatus,
    summary: nextPatch.summary,
    affectedFiles: nextPatch.affectedFiles,
    validationCommands: nextPatch.validationCommands,
    rolledBackAt: nextPatch.rolledBackAt,
    diffPath: path.relative(root, path.join(root, PATCHES_DIR_NAME, artifact.patchId, 'diff.txt')),
    patchPath: path.relative(root, artifactPath),
  };
  await writePendingPatch(root, pending);
  return {
    rolledBack: true,
    reason: null,
    patch: nextPatch,
  };
}

export async function getPatchStatus(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensurePatchWorkspace(root);
  const pending = await readPendingPatch(root);
  const latest = pending ? (await readPatchArtifact(root, pending.patchId) || pending) : null;
  return {
    pending: latest && latest.status === 'pending' ? latest : null,
    latest,
  };
}

export async function loadPatchByTask(projectRoot, taskSelector) {
  const root = normalizeRoot(projectRoot);
  const pending = await readPendingPatch(root);
  if (!pending) {
    return null;
  }
  if (pending.taskId !== taskSelector) {
    return null;
  }
  return readPatchArtifact(root, pending.patchId) || pending;
}

export { suggestValidationCommands };
