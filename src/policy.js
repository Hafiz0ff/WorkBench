import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from './security.js';

const POLICY_DIR_NAME = '.local-codex';
const POLICY_FILE_NAME = 'policy.json';
const POLICY_SCHEMA_VERSION = 1;

const DEFAULT_POLICY = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  approvalMode: 'on-request',
  autoMode: {
    enabled: true,
    requirePlanApproval: true,
    testCommand: 'npm test',
    testOnEachStep: true,
    retryMax: 3,
    maxSteps: 10,
    abortOnTestFail: false,
    allowedProviders: ['ollama', 'openai', 'anthropic', 'gemini'],
  },
  testRunner: {
    command: '',
    cwd: null,
    timeout: 120000,
    env: {},
    autoRun: {
      onPatchApply: true,
      onAutoStep: true,
    },
    onFail: {
      action: 'warn',
      rollbackPatches: true,
    },
    history: {
      keepLast: 100,
    },
    runners: [],
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    auth: {
      enabled: false,
      username: 'admin',
      passwordHash: '',
    },
    openOnStart: true,
    corsOrigins: [],
  },
  allowedReadGlobs: ['**/*'],
  allowedWriteGlobs: [
    'src/**',
    'app/**',
    'lib/**',
    'server/**',
    'client/**',
    'components/**',
    'packages/**',
    'test/**',
    'tests/**',
    'scripts/**',
    '*.md',
    '*.markdown',
    '*.txt',
    '*.json',
    '*.yml',
    '*.yaml',
    '*.toml',
    '*.js',
    '*.mjs',
    '*.cjs',
    '*.ts',
    '*.tsx',
    '*.jsx',
    '*.css',
    '*.scss',
    '*.less',
    '*.html',
  ],
  blockedPaths: [
    '.git/**',
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.next/**',
    'out/**',
    'tmp/**',
    'temp/**',
    '.turbo/**',
    '.cache/**',
    '.local-codex/**',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.webp',
    '**/*.svg',
    '**/*.ico',
    '**/*.pdf',
    '**/*.zip',
    '**/*.gz',
    '**/*.tgz',
    '**/*.rar',
    '**/*.7z',
    '**/*.mp3',
    '**/*.wav',
    '**/*.mp4',
    '**/*.mov',
  ],
  allowedCommands: [
    'git status',
    'git diff',
    'git log',
    'git show',
    'ls',
    'find',
    'rg',
    'cat',
    'sed',
    'head',
    'tail',
    'pwd',
    'npm test',
    'pytest',
    'npm run lint',
    'npm run format',
  ],
  blockedCommands: [
    'rm',
    'rm -rf',
    'sudo',
    'curl',
    'wget',
    'ssh',
    'scp',
    'rsync',
    'npm install',
    'npm i',
    'yarn add',
    'pnpm add',
    'pip install',
    'brew install',
    'git push',
    'git reset',
    'git clean',
  ],
  requireApprovalFor: {
    commands: ['npm install', 'npm i', 'yarn add', 'pnpm add', 'pip install', 'brew install', 'git push', 'git reset', 'git clean'],
    categories: ['install', 'network', 'mutating'],
  },
  maxCommandOutputChars: 20000,
};

function toPosixPath(value) {
  return String(value).replaceAll(path.sep, '/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = toPosixPath(pattern.trim());
  const escaped = escapeRegex(normalized)
    .replace(/\\\*\\\*\\\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function normalizeApprovalMode(value) {
  const mode = String(value || DEFAULT_POLICY.approvalMode).trim().toLowerCase();
  if (mode === 'strict' || mode === 'manual' || mode === 'on-request' || mode === 'review' || mode === 'auto-safe' || mode === 'auto' || mode === 'auto-with-tests') {
    return mode;
  }
  return DEFAULT_POLICY.approvalMode;
}

function isAutoLikeMode(mode) {
  return ['auto-safe', 'auto', 'auto-with-tests'].includes(String(mode || '').trim().toLowerCase());
}

function normalizePolicy(policy = {}) {
  const allowedReadGlobs = Array.isArray(policy.allowedReadGlobs) ? policy.allowedReadGlobs : DEFAULT_POLICY.allowedReadGlobs;
  const allowedWriteGlobs = Array.isArray(policy.allowedWriteGlobs) ? policy.allowedWriteGlobs : DEFAULT_POLICY.allowedWriteGlobs;
  const blockedPaths = Array.isArray(policy.blockedPaths) ? policy.blockedPaths : DEFAULT_POLICY.blockedPaths;
  const allowedCommands = Array.isArray(policy.allowedCommands) ? policy.allowedCommands : DEFAULT_POLICY.allowedCommands;
  const blockedCommands = Array.isArray(policy.blockedCommands) ? policy.blockedCommands : DEFAULT_POLICY.blockedCommands;
  const requireApprovalCommands = Array.isArray(policy.requireApprovalFor?.commands) ? policy.requireApprovalFor.commands : DEFAULT_POLICY.requireApprovalFor.commands;
  const requireApprovalCategories = Array.isArray(policy.requireApprovalFor?.categories) ? policy.requireApprovalFor.categories : DEFAULT_POLICY.requireApprovalFor.categories;
  const next = {
    ...DEFAULT_POLICY,
    ...policy,
    approvalMode: normalizeApprovalMode(policy.approvalMode),
    autoMode: {
      ...DEFAULT_POLICY.autoMode,
      ...(policy.autoMode || {}),
      retryMax: Number.isFinite(Number(policy.autoMode?.retryMax)) && Number(policy.autoMode?.retryMax) > 0
        ? Math.floor(Number(policy.autoMode.retryMax))
        : DEFAULT_POLICY.autoMode.retryMax,
      maxSteps: Number.isFinite(Number(policy.autoMode?.maxSteps)) && Number(policy.autoMode?.maxSteps) > 0
        ? Math.floor(Number(policy.autoMode.maxSteps))
        : DEFAULT_POLICY.autoMode.maxSteps,
      allowedProviders: normalizeStringList(policy.autoMode?.allowedProviders || DEFAULT_POLICY.autoMode.allowedProviders),
      testCommand: typeof policy.autoMode?.testCommand === 'string' && policy.autoMode.testCommand.trim()
        ? policy.autoMode.testCommand.trim()
        : DEFAULT_POLICY.autoMode.testCommand,
      enabled: policy.autoMode?.enabled !== false,
      requirePlanApproval: policy.autoMode?.requirePlanApproval !== false,
      testOnEachStep: policy.autoMode?.testOnEachStep !== false,
      abortOnTestFail: policy.autoMode?.abortOnTestFail === true,
    },
    testRunner: {
      ...DEFAULT_POLICY.testRunner,
      ...(policy.testRunner || {}),
      autoRun: {
        ...DEFAULT_POLICY.testRunner.autoRun,
        ...(policy.testRunner?.autoRun || {}),
      },
      onFail: {
        ...DEFAULT_POLICY.testRunner.onFail,
        ...(policy.testRunner?.onFail || {}),
      },
      history: {
        ...DEFAULT_POLICY.testRunner.history,
        ...(policy.testRunner?.history || {}),
      },
      runners: Array.isArray(policy.testRunner?.runners) ? policy.testRunner.runners : DEFAULT_POLICY.testRunner.runners,
      timeout: Number.isFinite(Number(policy.testRunner?.timeout)) && Number(policy.testRunner?.timeout) > 0
        ? Math.floor(Number(policy.testRunner.timeout))
        : DEFAULT_POLICY.testRunner.timeout,
      command: typeof policy.testRunner?.command === 'string' ? policy.testRunner.command.trim() : DEFAULT_POLICY.testRunner.command,
      cwd: typeof policy.testRunner?.cwd === 'string' && policy.testRunner.cwd.trim() ? policy.testRunner.cwd.trim() : DEFAULT_POLICY.testRunner.cwd,
      env: policy.testRunner?.env && typeof policy.testRunner.env === 'object' ? { ...policy.testRunner.env } : DEFAULT_POLICY.testRunner.env,
    },
    server: {
      ...DEFAULT_POLICY.server,
      ...(policy.server || {}),
      auth: {
        ...DEFAULT_POLICY.server.auth,
        ...(policy.server?.auth || {}),
        enabled: policy.server?.auth?.enabled === true,
        username: typeof policy.server?.auth?.username === 'string' && policy.server.auth.username.trim()
          ? policy.server.auth.username.trim()
          : DEFAULT_POLICY.server.auth.username,
        passwordHash: typeof policy.server?.auth?.passwordHash === 'string'
          ? policy.server.auth.passwordHash.trim()
          : DEFAULT_POLICY.server.auth.passwordHash,
      },
      port: Number.isFinite(Number(policy.server?.port)) && Number(policy.server?.port) > 0
        ? Math.floor(Number(policy.server.port))
        : DEFAULT_POLICY.server.port,
      host: typeof policy.server?.host === 'string' && policy.server.host.trim()
        ? policy.server.host.trim()
        : DEFAULT_POLICY.server.host,
      openOnStart: policy.server?.openOnStart !== false,
      corsOrigins: normalizeStringList(policy.server?.corsOrigins || DEFAULT_POLICY.server.corsOrigins),
    },
    allowedReadGlobs: normalizeStringList(allowedReadGlobs),
    allowedWriteGlobs: normalizeStringList(allowedWriteGlobs),
    blockedPaths: normalizeStringList(blockedPaths),
    allowedCommands: normalizeStringList(allowedCommands),
    blockedCommands: normalizeStringList(blockedCommands),
    requireApprovalFor: {
      commands: normalizeStringList(requireApprovalCommands),
      categories: normalizeStringList(requireApprovalCategories),
    },
    maxCommandOutputChars: Number.isFinite(policy.maxCommandOutputChars) && policy.maxCommandOutputChars > 0
      ? Math.floor(policy.maxCommandOutputChars)
      : DEFAULT_POLICY.maxCommandOutputChars,
  };
  next.schemaVersion = POLICY_SCHEMA_VERSION;
  return next;
}

function coerceProjectRoot(projectRoot) {
  if (typeof projectRoot === 'string') {
    return projectRoot;
  }
  if (projectRoot && typeof projectRoot === 'object') {
    if (typeof projectRoot.projectRoot === 'string') {
      return projectRoot.projectRoot;
    }
    if (typeof projectRoot.root === 'string') {
      return projectRoot.root;
    }
    if (typeof projectRoot.cwd === 'string') {
      return projectRoot.cwd;
    }
  }
  return projectRoot;
}

function getPolicyRoot(projectRoot) {
  return path.join(normalizeRoot(coerceProjectRoot(projectRoot)), POLICY_DIR_NAME);
}

function buildPolicyPath(projectRoot) {
  return path.join(getPolicyRoot(projectRoot), POLICY_FILE_NAME);
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

async function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, encoding);
  await fs.rename(tempPath, filePath);
}

function matchesAnyPattern(value, patterns) {
  const normalizedValue = toPosixPath(value);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedValue));
}

function normalizeRelativePath(projectRoot, targetPath) {
  const root = normalizeRoot(projectRoot);
  const absolute = path.resolve(root, targetPath);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${targetPath}`);
  }
  return toPosixPath(relative || '.');
}

function normalizeCommandLine(command, args = []) {
  return [command, ...args].filter(Boolean).join(' ').trim();
}

function isReadOnlyCommand(command, args = []) {
  const line = normalizeCommandLine(command, args);
  return [
    'git status',
    'git diff',
    'git log',
    'git show',
    'ls',
    'find',
    'rg',
    'cat',
    'sed',
    'head',
    'tail',
    'pwd',
  ].some((prefix) => line === prefix || line.startsWith(`${prefix} `));
}

function classifyCommand(command, args = []) {
  const line = normalizeCommandLine(command, args);
  if (isReadOnlyCommand(command, args)) {
    return 'read';
  }
  if (/^(npm|npx|yarn|pnpm)\s+(test|run\s+(lint|format|check|test))(\s|$)/.test(line) || /^pytest(\s|$)/.test(line)) {
    return 'validation';
  }
  if (/^(npm|npx|yarn|pnpm|pip|pip3|brew)\s+(install|i|add|remove|uninstall|upgrade|update)(\s|$)/.test(line)) {
    return 'install';
  }
  if (/^(curl|wget|ssh|scp|rsync)(\s|$)/.test(line)) {
    return 'network';
  }
  if (/^(rm|mv|cp|mkdir|touch|chmod|chown)(\s|$)/.test(line) || /^(git\s+(add|commit|push|pull|checkout|reset|clean|merge|rebase|stash))(\s|$)/.test(line)) {
    return 'mutating';
  }
  return 'unknown';
}

function makeDecision(decision, reason, extra = {}) {
  return {
    decision,
    allowed: decision === 'allow',
    blocked: decision === 'blocked',
    approvalRequired: decision === 'approval_required',
    reason,
    ...extra,
  };
}

export function getDefaultPolicy() {
  return normalizePolicy(DEFAULT_POLICY);
}

export function getPolicyPath(projectRoot) {
  return buildPolicyPath(projectRoot);
}

export async function ensureProjectPolicy(projectRoot) {
  const root = normalizeRoot(coerceProjectRoot(projectRoot));
  const policyRoot = getPolicyRoot(root);
  await ensureDirectory(policyRoot);
  const policyPath = buildPolicyPath(root);
  if (!(await fileExists(policyPath))) {
    await atomicWriteFile(policyPath, `${JSON.stringify(getDefaultPolicy(), null, 2)}\n`);
  }
  return {
    policyRoot,
    policyPath,
  };
}

export async function readProjectPolicy(projectRoot) {
  const root = normalizeRoot(coerceProjectRoot(projectRoot));
  await ensureProjectPolicy(root);
  const policyPath = buildPolicyPath(root);
  try {
    const content = await fs.readFile(policyPath, 'utf8');
    return normalizePolicy(JSON.parse(content));
  } catch {
    return getDefaultPolicy();
  }
}

export async function writeProjectPolicy(projectRoot, policy) {
  const root = normalizeRoot(coerceProjectRoot(projectRoot));
  await ensureProjectPolicy(root);
  const policyPath = buildPolicyPath(root);
  const normalized = normalizePolicy(policy);
  await atomicWriteFile(policyPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function listAllowedShellCommandsFromPolicy(policy) {
  return normalizePolicy(policy).allowedCommands;
}

export async function listAllowedShellCommands(projectRoot) {
  const policy = await readProjectPolicy(projectRoot);
  return listAllowedShellCommandsFromPolicy(policy);
}

export function evaluatePathPolicy(policyInput, targetPath, operation = 'read', projectRoot = process.cwd()) {
  const policy = normalizePolicy(policyInput);
  const relativePath = normalizeRelativePath(coerceProjectRoot(projectRoot), targetPath);
  const blocked = matchesAnyPattern(relativePath, policy.blockedPaths);
  if (blocked) {
    return makeDecision('blocked', `Path is blocked by policy: ${relativePath}`, {
      path: relativePath,
      operation,
    });
  }

  const isReadOperation = operation === 'read';
  const matchedAllowed = isReadOperation
    ? matchesAnyPattern(relativePath, policy.allowedReadGlobs)
    : matchesAnyPattern(relativePath, policy.allowedWriteGlobs);

  if (isReadOperation) {
    if (matchedAllowed) {
      return makeDecision('allow', `Path allowed for read: ${relativePath}`, {
        path: relativePath,
        operation,
      });
    }
    return makeDecision(
      isAutoLikeMode(policy.approvalMode) ? 'blocked' : 'approval_required',
      `Path is not listed in read allow globs: ${relativePath}`,
      {
        path: relativePath,
        operation,
      },
    );
  }

  if (matchedAllowed) {
    if (isAutoLikeMode(policy.approvalMode)) {
      return makeDecision('allow', `Path allowed for write: ${relativePath}`, {
        path: relativePath,
        operation,
      });
    }
    return makeDecision('approval_required', `Write access requires approval: ${relativePath}`, {
      path: relativePath,
      operation,
    });
  }

  return makeDecision(
    isAutoLikeMode(policy.approvalMode) ? 'blocked' : 'approval_required',
    `Path is not listed in write allow globs: ${relativePath}`,
    {
      path: relativePath,
      operation,
    },
  );
}

export function evaluateCommandPolicy(policyInput, command, args = []) {
  const policy = normalizePolicy(policyInput);
  const fullCommand = normalizeCommandLine(command, args);
  const category = classifyCommand(command, args);

  if (matchesAnyPattern(fullCommand, policy.blockedCommands) || matchesAnyPattern(command, policy.blockedCommands)) {
    return makeDecision('blocked', `Command is blocked by policy: ${fullCommand}`, {
      command,
      args,
      category,
    });
  }

  const explicitlyAllowed = matchesAnyPattern(fullCommand, policy.allowedCommands) || matchesAnyPattern(command, policy.allowedCommands);
  const requiresApprovalByRule = matchesAnyPattern(fullCommand, policy.requireApprovalFor.commands)
    || matchesAnyPattern(command, policy.requireApprovalFor.commands)
    || policy.requireApprovalFor.categories.includes(category);

  if (category === 'read') {
    if (explicitlyAllowed) {
      return makeDecision('allow', `Command is allowed: ${fullCommand}`, {
        command,
        args,
        category,
      });
    }
    return makeDecision(
      isAutoLikeMode(policy.approvalMode) ? 'blocked' : 'approval_required',
      `Command is not listed as a safe read command: ${fullCommand}`,
      {
        command,
        args,
        category,
      },
    );
  }

  if (category === 'validation') {
    if (isAutoLikeMode(policy.approvalMode) && explicitlyAllowed && !requiresApprovalByRule) {
      return makeDecision('allow', `Validation command is allowed: ${fullCommand}`, {
        command,
        args,
        category,
      });
    }
    return makeDecision('approval_required', `Validation command requires approval: ${fullCommand}`, {
      command,
      args,
      category,
    });
  }

  if (requiresApprovalByRule) {
    return makeDecision('approval_required', `Command requires approval: ${fullCommand}`, {
      command,
      args,
      category,
    });
  }

  return makeDecision(
    isAutoLikeMode(policy.approvalMode) && explicitlyAllowed ? 'allow' : 'approval_required',
    `Command requires approval: ${fullCommand}`,
    {
      command,
      args,
      category,
    },
  );
}

export function getPolicySummary(policyInput) {
  const policy = normalizePolicy(policyInput);
  return {
    approvalMode: policy.approvalMode,
    autoMode: { ...policy.autoMode },
    testRunner: {
      ...policy.testRunner,
      runners: Array.isArray(policy.testRunner?.runners) ? [...policy.testRunner.runners] : [],
      env: { ...(policy.testRunner?.env || {}) },
      autoRun: { ...(policy.testRunner?.autoRun || {}) },
      onFail: { ...(policy.testRunner?.onFail || {}) },
      history: { ...(policy.testRunner?.history || {}) },
    },
    server: {
      ...policy.server,
      auth: { ...(policy.server?.auth || {}) },
      corsOrigins: Array.isArray(policy.server?.corsOrigins) ? [...policy.server.corsOrigins] : [],
    },
    allowedReadGlobs: [...policy.allowedReadGlobs],
    allowedWriteGlobs: [...policy.allowedWriteGlobs],
    blockedPaths: [...policy.blockedPaths],
    allowedCommands: [...policy.allowedCommands],
    blockedCommands: [...policy.blockedCommands],
    requireApprovalFor: {
      commands: [...policy.requireApprovalFor.commands],
      categories: [...policy.requireApprovalFor.categories],
    },
    maxCommandOutputChars: policy.maxCommandOutputChars,
  };
}

export function getAutoModeConfig(policyInput) {
  return normalizePolicy(policyInput).autoMode;
}

export function getTestRunnerConfig(policyInput) {
  return normalizePolicy(policyInput).testRunner;
}
