import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeRoot } from './security.js';
import { evaluateCommandPolicy, readProjectPolicy, writeProjectPolicy } from './policy.js';

const TEST_RUNS_FILE_NAME = 'test-runs.jsonl';
const TEST_RUNS_DIR_NAME = 'test-runs';
const TEST_RUN_SCHEMA_VERSION = 1;
const TEST_RUNS_HISTORY_DEFAULT = 100;
const OUTPUT_LIMIT = 50 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function randomToken(length = 6) {
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0');
}

function createRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `testrun-${stamp}-${randomToken(6)}`;
}

function toPosixPath(value) {
  return String(value || '').replaceAll(path.sep, '/');
}

function parseCommandLine(commandLine) {
  const text = String(commandLine || '').trim();
  if (!text) {
    return null;
  }
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) {
    parts.push(current);
  }

  if (!parts.length) {
    return null;
  }

  return { command: parts[0], args: parts.slice(1) };
}

function truncateText(value, limit = OUTPUT_LIMIT) {
  const text = String(value || '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} characters]`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getTestRunsRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), '.local-codex');
}

function getTestRunsFile(projectRoot) {
  return path.join(getTestRunsRoot(projectRoot), TEST_RUNS_FILE_NAME);
}

function getTestRunsDir(projectRoot) {
  return path.join(getTestRunsRoot(projectRoot), TEST_RUNS_DIR_NAME);
}

export function getTestRunLogPath(projectRoot, runId) {
  return path.join(getTestRunsDir(projectRoot), `${runId}.log`);
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeTestRunnerConfig(policyInput = {}) {
  const policy = policyInput || {};
  const runner = policy.testRunner || {};
  return {
    command: typeof runner.command === 'string' ? runner.command.trim() : '',
    cwd: typeof runner.cwd === 'string' && runner.cwd.trim() ? runner.cwd.trim() : null,
    timeout: normalizeNumber(runner.timeout, 120000),
    env: runner.env && typeof runner.env === 'object' ? { ...runner.env } : {},
    autoRun: {
      onPatchApply: runner.autoRun?.onPatchApply !== false,
      onAutoStep: runner.autoRun?.onAutoStep !== false,
    },
    onFail: {
      action: ['warn', 'rollback', 'ask'].includes(runner.onFail?.action) ? runner.onFail.action : 'warn',
      rollbackPatches: runner.onFail?.rollbackPatches !== false,
    },
    history: {
      keepLast: normalizeNumber(runner.history?.keepLast, TEST_RUNS_HISTORY_DEFAULT),
    },
    runners: Array.isArray(runner.runners) ? runner.runners
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name.trim() : '',
        command: typeof entry.command === 'string' ? entry.command.trim() : '',
        cwd: typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : null,
        runOrder: normalizeNumber(entry.runOrder, 0),
        runOnAuto: entry.runOnAuto !== false,
        timeout: normalizeNumber(entry.timeout, 120000),
      }))
      .filter((entry) => entry.command) : [],
  };
}

async function readJsonLines(filePath) {
  if (!(await fileExists(filePath))) {
    return [];
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function writeJsonLines(filePath, entries) {
  await ensureDir(path.dirname(filePath));
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
}

async function appendJsonLine(filePath, entry) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function parseNodeTestRunnerSummary(output) {
  const summary = {};
  const passedMatch = output.match(/(?:ℹ\s+)?pass(?:ed)?\s+(\d+)/i);
  const failedMatch = output.match(/(?:ℹ\s+)?fail(?:ed)?\s+(\d+)/i);
  const skippedMatch = output.match(/(?:ℹ\s+)?skipped\s+(\d+)/i);
  const testsMatch = output.match(/(?:ℹ\s+)?tests\s+(\d+)/i);
  if (testsMatch) {
    summary.total = Number(testsMatch[1]);
  }
  if (passedMatch) {
    summary.passed = Number(passedMatch[1]);
  }
  if (failedMatch) {
    summary.failed = Number(failedMatch[1]);
  }
  if (skippedMatch) {
    summary.skipped = Number(skippedMatch[1]);
  }
  return Object.keys(summary).length ? summary : null;
}

function parseJestLikeSummary(output) {
  const totalMatch = output.match(/Tests?:\s+(\d+)\s+total/i) || output.match(/Test Files\s+.*?(\d+)\s+total/i);
  const passedMatch = output.match(/Tests?:\s+(\d+)\s+passed/i) || output.match(/Test Files\s+.*?(\d+)\s+passed/i);
  const failedMatch = output.match(/Tests?:\s+(\d+)\s+failed/i) || output.match(/Test Files\s+.*?(\d+)\s+failed/i);
  const skippedMatch = output.match(/Tests?:\s+(\d+)\s+skipped/i) || output.match(/Test Files\s+.*?(\d+)\s+skipped/i);
  const summary = {};
  if (totalMatch) summary.total = Number(totalMatch[1]);
  if (passedMatch) summary.passed = Number(passedMatch[1]);
  if (failedMatch) summary.failed = Number(failedMatch[1]);
  if (skippedMatch) summary.skipped = Number(skippedMatch[1]);
  return Object.keys(summary).length ? summary : null;
}

function parsePytestSummary(output) {
  const match = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i);
  if (!match) {
    return null;
  }
  const summary = {
    passed: Number(match[1]),
  };
  if (match[2]) summary.failed = Number(match[2]);
  if (match[3]) summary.skipped = Number(match[3]);
  summary.total = (summary.passed || 0) + (summary.failed || 0) + (summary.skipped || 0);
  return summary;
}

function parseSwiftSummary(output) {
  const executedMatch = output.match(/Executed\s+(\d+)\s+tests?/i);
  const failuresMatch = output.match(/with\s+(\d+)\s+failures?/i);
  if (!executedMatch && !failuresMatch) {
    return null;
  }
  const total = executedMatch ? Number(executedMatch[1]) : null;
  const failed = failuresMatch ? Number(failuresMatch[1]) : 0;
  return {
    total,
    passed: total !== null ? Math.max(total - failed, 0) : undefined,
    failed,
  };
}

function parseGoSummary(output) {
  if (/FAIL/i.test(output)) {
    const failMatches = [...output.matchAll(/--- FAIL:\s+(.+)/g)].map((match) => ({ name: match[1].trim(), error: '' }));
    return {
      failed: failMatches.length || 1,
      failedTests: failMatches,
    };
  }
  const okMatch = output.match(/^ok\s+\S+/m);
  if (okMatch) {
    return { passed: 1, total: 1 };
  }
  return null;
}

function parseCargoSummary(output) {
  const match = output.match(/test result:\s+ok\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/i);
  if (!match) {
    return null;
  }
  const passed = Number(match[1]);
  const failed = Number(match[2]);
  const skipped = Number(match[3]);
  return {
    total: passed + failed + skipped,
    passed,
    failed,
    skipped,
  };
}

function parseSummary(output, runner, exitCode) {
  const trimmed = String(output || '');
  const parsers = [
    runner === 'node' ? parseNodeTestRunnerSummary(trimmed) : null,
    runner === 'jest' || runner === 'vitest' ? parseJestLikeSummary(trimmed) : null,
    runner === 'pytest' ? parsePytestSummary(trimmed) : null,
    runner === 'swift' ? parseSwiftSummary(trimmed) : null,
    runner === 'go' ? parseGoSummary(trimmed) : null,
    runner === 'cargo' ? parseCargoSummary(trimmed) : null,
    parseNodeTestRunnerSummary(trimmed),
    parseJestLikeSummary(trimmed),
    parsePytestSummary(trimmed),
    parseSwiftSummary(trimmed),
    parseGoSummary(trimmed),
    parseCargoSummary(trimmed),
  ].filter(Boolean);
  if (parsers.length) {
    return parsers[0];
  }
  return exitCode === 0 ? { total: 0, passed: 0, failed: 0 } : null;
}

function parseFailedTests(output) {
  const lines = String(output || '').split(/\r?\n/);
  const failed = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*(?:--- FAIL:|FAIL\s+|✗\s+)/.test(line)) {
      if (current) {
        failed.push(current);
      }
      current = { name: line.replace(/^\s*(?:--- FAIL:|FAIL\s+|✗\s+)/, '').trim(), error: '' };
      continue;
    }
    if (current && line.trim() && !/^(?:PASS|ok\s+)/i.test(line)) {
      current.error = current.error ? `${current.error}\n${line}` : line;
    }
  }
  if (current) {
    failed.push(current);
  }
  return failed;
}

export { parseSummary as parseTestRunSummary, parseFailedTests as parseTestRunFailures };

function normalizeCommandEntry(command) {
  if (!command) {
    return null;
  }
  if (typeof command === 'string') {
    return parseCommandLine(command);
  }
  if (typeof command === 'object' && typeof command.command === 'string') {
    return {
      command: command.command.trim(),
      args: Array.isArray(command.args) ? command.args.filter((arg) => typeof arg === 'string' && arg.trim()) : [],
    };
  }
  return null;
}

function resolveRunnerCommand(projectRoot, policyConfig, entry = null) {
  const config = normalizeTestRunnerConfig(policyConfig);
  if (entry) {
    const parsed = normalizeCommandEntry(entry.command || entry);
    if (!parsed) {
      return null;
    }
    return {
      command: parsed.command,
      args: parsed.args,
      cwd: entry.cwd || config.cwd || null,
      timeout: normalizeNumber(entry.timeout, config.timeout),
      runner: entry.name || inferRunnerName(parsed.command),
      runOnAuto: entry.runOnAuto !== false,
    };
  }

  if (config.command) {
    const parsed = normalizeCommandEntry(config.command);
    if (parsed) {
      return {
        command: parsed.command,
        args: parsed.args,
        cwd: config.cwd,
        timeout: config.timeout,
        runner: inferRunnerName(parsed.command),
        runOnAuto: true,
      };
    }
  }

  return null;
}

function inferRunnerName(command) {
  const line = String(command || '').trim();
  if (/^npm\s+test(\s|$)/i.test(line) || /^node\s+.*test/i.test(line)) {
    return 'node';
  }
  if (/^pytest(\s|$)/i.test(line)) {
    return 'pytest';
  }
  if (/^swift\s+test(\s|$)/i.test(line)) {
    return 'swift';
  }
  if (/^cargo\s+test(\s|$)/i.test(line)) {
    return 'cargo';
  }
  if (/^go\s+test(\s|$)/i.test(line)) {
    return 'go';
  }
  if (/^make\s+test(\s|$)/i.test(line)) {
    return 'make';
  }
  if (/^jest(\s|$)/i.test(line)) {
    return 'jest';
  }
  if (/^vitest(\s|$)/i.test(line)) {
    return 'vitest';
  }
  return 'shell';
}

async function executeCommand(root, command, args, options = {}) {
  const cwd = options.cwd ? path.resolve(normalizeRoot(root), options.cwd) : normalizeRoot(root);
  const env = { ...process.env, ...(options.env || {}) };

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const startedAt = Date.now();
    const timeoutMs = normalizeNumber(options.timeout, 120000);

    const finalize = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finalize({
        status: 'timeout',
        exitCode: null,
        stdout,
        stderr,
        duration: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finalize({
        status: 'error',
        exitCode: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        duration: Date.now() - startedAt,
      });
    });

    child.on('close', (code) => {
      const status = code === 0 ? 'passed' : 'failed';
      finalize({
        status,
        exitCode: code ?? 0,
        stdout,
        stderr,
        duration: Date.now() - startedAt,
      });
    });
  });
}

async function saveRunRecord(projectRoot, run, logOutput = '') {
  const root = normalizeRoot(projectRoot);
  const jsonlPath = getTestRunsFile(root);
  const logDir = getTestRunsDir(root);
  await ensureDir(path.dirname(jsonlPath));
  await ensureDir(logDir);
  const metadata = {
    schemaVersion: TEST_RUN_SCHEMA_VERSION,
    runId: run.runId,
    taskId: run.taskId || null,
    patchId: run.patchId || null,
    command: run.command,
    runner: run.runner || null,
    status: run.status,
    exitCode: run.exitCode,
    duration: run.duration,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    summary: run.summary || null,
  };
  await appendJsonLine(jsonlPath, metadata);
  await fs.writeFile(getTestRunLogPath(root, run.runId), `${logOutput || ''}`, 'utf8');
  return metadata;
}

export async function ensureTestRunnerWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureDir(getTestRunsRoot(root));
  await ensureDir(getTestRunsDir(root));
  return {
    historyPath: getTestRunsFile(root),
    logsDir: getTestRunsDir(root),
  };
}

export async function getTestRunnerConfig(source) {
  if (typeof source === 'string' || source instanceof String) {
    const policy = await readProjectPolicy(source);
    return normalizeTestRunnerConfig(policy);
  }
  if (source && typeof source === 'object') {
    return normalizeTestRunnerConfig(source);
  }
  return normalizeTestRunnerConfig({});
}

export async function writeTestRunnerConfig(projectRoot, config) {
  const policy = await readProjectPolicy(projectRoot);
  const next = {
    ...policy,
    testRunner: {
      ...normalizeTestRunnerConfig(policy),
      ...(config || {}),
    },
  };
  return writeProjectPolicy(projectRoot, next);
}

export async function detectRunner(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const packageJsonPath = path.join(root, 'package.json');
  if (await fileExists(packageJsonPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const scripts = pkg.scripts || {};
      if (typeof scripts.test === 'string' && scripts.test.trim()) {
        return {
          name: 'node',
          command: scripts.test.trim(),
          cwd: null,
          source: 'package.json:scripts.test',
        };
      }
    } catch {
      // ignore invalid package json
    }
  }

  const pythonFiles = ['pytest.ini', 'pyproject.toml', 'setup.py'];
  if (await Promise.all(pythonFiles.map((name) => fileExists(path.join(root, name)))).then((items) => items.some(Boolean))) {
    return {
      name: 'pytest',
      command: 'pytest',
      cwd: null,
      source: 'pytest',
    };
  }

  const makefilePath = path.join(root, 'Makefile');
  if (await fileExists(makefilePath)) {
    const content = await fs.readFile(makefilePath, 'utf8').catch(() => '');
    if (/^test\s*:/m.test(content)) {
      return {
        name: 'make',
        command: 'make test',
        cwd: null,
        source: 'Makefile:test',
      };
    }
  }

  const swiftCandidates = [
    path.join(root, 'Package.swift'),
    path.join(root, 'macos', 'Package.swift'),
    path.join(root, 'macos', 'LocalCodexMac', 'Package.swift'),
  ];
  for (const candidate of swiftCandidates) {
    if (await fileExists(candidate)) {
      const cwd = path.relative(root, path.dirname(candidate)) || null;
      return {
        name: 'swift',
        command: 'swift test',
        cwd,
        source: path.relative(root, candidate),
      };
    }
  }

  const cargoPath = path.join(root, 'Cargo.toml');
  if (await fileExists(cargoPath)) {
    return {
      name: 'cargo',
      command: 'cargo test',
      cwd: null,
      source: 'Cargo.toml',
    };
  }

  const goModPath = path.join(root, 'go.mod');
  if (await fileExists(goModPath)) {
    return {
      name: 'go',
      command: 'go test ./...',
      cwd: null,
      source: 'go.mod',
    };
  }

  return {
    name: 'node',
    command: 'npm test',
    cwd: null,
    source: 'default',
  };
}

export async function runTests(options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || options.cwd || process.cwd());
  await ensureTestRunnerWorkspace(projectRoot);
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const runnerConfig = normalizeTestRunnerConfig(policy);
  const commandEntry = normalizeCommandEntry(options.command || runnerConfig.command) || normalizeCommandEntry((await detectRunner(projectRoot)).command);
  if (!commandEntry) {
    return {
      runId: createRunId(),
      command: '',
      status: 'skipped',
      exitCode: null,
      duration: 0,
      startedAt: nowIso(),
      completedAt: nowIso(),
      patchId: options.patchId || null,
      taskId: options.taskId || null,
      runner: 'unknown',
      summary: null,
      output: '',
      failedTests: [],
      skipped: true,
      reason: 'no_command',
    };
  }

  const commandText = [commandEntry.command, ...commandEntry.args].filter(Boolean).join(' ').trim();
  const decision = options.allowApprovalBypass
    ? { blocked: false, approvalRequired: false, decision: 'allow' }
    : evaluateCommandPolicy(policy, commandEntry.command, commandEntry.args);

  const runId = createRunId();
  const startedAt = nowIso();

  if (decision.blocked) {
    const result = {
      runId,
      command: commandText,
      status: 'error',
      exitCode: null,
      duration: 0,
      startedAt,
      completedAt: nowIso(),
      patchId: options.patchId || null,
      taskId: options.taskId || null,
      runner: options.runner || inferRunnerName(commandEntry.command),
      summary: null,
      output: '',
      failedTests: [],
      skipped: true,
      reason: decision.reason,
    };
    await saveRunRecord(projectRoot, result, '');
    return result;
  }

  if (decision.approvalRequired && !options.allowApprovalBypass) {
    const result = {
      runId,
      command: commandText,
      status: 'skipped',
      exitCode: null,
      duration: 0,
      startedAt,
      completedAt: nowIso(),
      patchId: options.patchId || null,
      taskId: options.taskId || null,
      runner: options.runner || inferRunnerName(commandEntry.command),
      summary: null,
      output: '',
      failedTests: [],
      skipped: true,
      reason: decision.reason,
      approvalRequired: true,
    };
    await saveRunRecord(projectRoot, result, '');
    return result;
  }

  const execResult = await executeCommand(projectRoot, commandEntry.command, commandEntry.args, {
    cwd: options.cwd || commandEntry.cwd || runnerConfig.cwd || null,
    env: { ...runnerConfig.env, ...(options.env || {}) },
    timeout: options.timeout || commandEntry.timeout || runnerConfig.timeout,
  });

  const output = `${execResult.stdout || ''}${execResult.stderr ? `\n${execResult.stderr}` : ''}`.trim();
  const summary = parseSummary(output, options.runner || inferRunnerName(commandEntry.command), execResult.exitCode);
  const failedTests = execResult.status === 'passed' ? [] : parseFailedTests(output);
  const result = {
    runId,
    command: commandText,
    status: execResult.status,
    exitCode: execResult.exitCode,
    duration: execResult.duration,
    startedAt,
    completedAt: nowIso(),
    patchId: options.patchId || null,
    taskId: options.taskId || null,
    runner: options.runner || inferRunnerName(commandEntry.command),
    summary,
    output: truncateText(output, OUTPUT_LIMIT),
    failedTests,
    skipped: false,
  };
  await saveRunRecord(projectRoot, result, output);
  return result;
}

export async function runConfiguredTests(projectRoot, options = {}) {
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const runnerConfig = normalizeTestRunnerConfig(policy);
  const configured = Array.isArray(options.commands) && options.commands.length
    ? options.commands
    : runnerConfig.runners.length
      ? [...runnerConfig.runners].sort((a, b) => a.runOrder - b.runOrder)
      : [resolveRunnerCommand(projectRoot, policy) || await detectRunner(projectRoot)];

  const results = [];
  for (const entry of configured) {
    if (!entry) {
      continue;
    }
    if (options.onlyAuto && entry.runOnAuto === false) {
      continue;
    }
    const result = await runTests({
      projectRoot,
      policy,
      taskId: options.taskId || null,
      patchId: options.patchId || null,
      command: typeof entry === 'string'
        ? entry
        : entry.command
          ? { command: entry.command, args: entry.args || [] }
          : entry,
      cwd: entry.cwd || runnerConfig.cwd || null,
      timeout: entry.timeout || runnerConfig.timeout,
      env: runnerConfig.env,
      runner: entry.name || inferRunnerName(entry.command),
      allowApprovalBypass: options.allowApprovalBypass !== false,
    });
    results.push(result);
    if (result.status !== 'passed' && options.stopOnFailure) {
      break;
    }
  }
  return results;
}

export async function getHistory(projectRoot, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensureTestRunnerWorkspace(root);
  const entries = await readJsonLines(getTestRunsFile(root));
  const filtered = entries.filter((entry) => {
    if (options.taskId && entry.taskId !== options.taskId) {
      return false;
    }
    if (options.status && entry.status !== options.status) {
      return false;
    }
    if (options.since && entry.startedAt && entry.startedAt < options.since) {
      return false;
    }
    return true;
  });
  filtered.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : filtered.length;
  return filtered.slice(0, limit);
}

export async function pruneHistory(projectRoot, keepLast = TEST_RUNS_HISTORY_DEFAULT) {
  const root = normalizeRoot(projectRoot);
  await ensureTestRunnerWorkspace(root);
  const entries = await readJsonLines(getTestRunsFile(root));
  if (entries.length <= keepLast) {
    return { pruned: 0, kept: entries.length };
  }
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => String(a.entry.startedAt || '').localeCompare(String(b.entry.startedAt || '')));
  const keepSet = new Set(sorted.slice(-keepLast).map((item) => item.index));
  const nextEntries = entries.filter((_, index) => keepSet.has(index));
  const removed = entries.filter((_, index) => !keepSet.has(index));
  await writeJsonLines(getTestRunsFile(root), nextEntries);
  for (const entry of removed) {
    await fs.rm(path.join(getTestRunsDir(root), `${entry.runId}.log`), { force: true }).catch(() => {});
  }
  return {
    pruned: removed.length,
    kept: nextEntries.length,
  };
}

export async function getTestRun(projectRoot, runId) {
  const history = await getHistory(projectRoot, {});
  return history.find((entry) => entry.runId === runId) || null;
}

export async function readTestRunLog(projectRoot, runId) {
  const root = normalizeRoot(projectRoot);
  return fs.readFile(getTestRunLogPath(root, runId), 'utf8');
}

export async function updatePolicyWithDetectedRunner(projectRoot, detection) {
  const policy = await readProjectPolicy(projectRoot);
  const next = {
    ...policy,
    testRunner: {
      ...normalizeTestRunnerConfig(policy),
      command: detection.command,
      cwd: detection.cwd || null,
      runner: detection.name || inferRunnerName(detection.command),
      source: detection.source || 'auto-detect',
    },
  };
  await writeProjectPolicy(projectRoot, next);
  return next.testRunner;
}
