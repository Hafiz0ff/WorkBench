import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from './security.js';
import { readProjectPolicy, getAutoModeConfig } from './policy.js';
import { getProvider } from './providers/index.js';
import { summarizeCurrentMemory } from './memory.js';
import {
  appendTaskNote,
  getCurrentTaskContext,
  resolveTask,
  setCurrentTask,
  setTaskLastSessionId,
  showTask,
} from './tasks.js';
import { stageProjectPatch, applyPatchSilent, rollbackPatch, getPatchStatus } from './patches.js';
import { appendMessage, createMessageId, createSessionId, ensureConversationSummary, readConversationSummary } from './conversation.js';
import { listAllowedShellCommands } from './shell.js';
import { composePromptLayers, BASE_SYSTEM_INSTRUCTIONS } from './prompt-composer.js';
import { generatePatch } from './agent.js';
import { trackEvent } from './stats.js';
import { checkLimit, createBudgetError, trackUsage } from './budget.js';

const AUTO_RUN_DIR_NAME = 'auto-runs';
const CURRENT_AUTO_RUN_FILE = 'auto-run.json';

function nowIso() {
  return new Date().toISOString();
}

function randomToken(length = 6) {
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0');
}

function createRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `run-${stamp}-${randomToken(6)}`;
}

function normalizeTaskId(task) {
  return task?.id || null;
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

  return {
    command: parts[0],
    args: parts.slice(1),
  };
}

function normalizeValidationCommands(value) {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  const commands = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    if (typeof item === 'string') {
      const parsed = parseCommandLine(item);
      if (parsed) {
        commands.push(parsed);
      }
      continue;
    }
    if (typeof item === 'object') {
      const command = typeof item.command === 'string' ? item.command.trim() : '';
      if (!command) {
        continue;
      }
      commands.push({
        command,
        args: Array.isArray(item.args)
          ? item.args.filter((arg) => typeof arg === 'string' && arg.trim())
          : [],
      });
    }
  }
  return commands;
}

function chooseTaskContext(task, taskContext, locale) {
  return async (projectRoot) => {
    if (taskContext) {
      return taskContext;
    }
    const info = await showTask(projectRoot, task.id, locale);
    return info.context;
  };
}

function stripFence(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return trimmed;
}

function parseJsonPayload(text) {
  const cleaned = stripFence(text);
  const start = cleaned.indexOf('{');
  const arrayStart = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf('}');
  const arrayEnd = cleaned.lastIndexOf(']');
  const isArray = arrayStart !== -1 && arrayEnd !== -1 && arrayStart < arrayEnd && (start === -1 || arrayStart < start);
  const slice = isArray ? cleaned.slice(arrayStart, arrayEnd + 1) : cleaned.slice(start, end + 1);
  return JSON.parse(slice);
}

async function collectProviderText(projectRoot, provider, messages, model, { policy = null } = {}) {
  if (projectRoot) {
    const budgetCheck = await checkLimit(projectRoot, provider?.name || 'unknown');
    const resolvedPolicy = policy || await readProjectPolicy(projectRoot).catch(() => null);
    if (!budgetCheck.ok && resolvedPolicy?.budget?.onExceed === 'block') {
      throw createBudgetError('Token budget exceeded.', budgetCheck.exceeded);
    }
  }
  let content = '';
  for await (const chunk of provider.chat(messages, { model })) {
    content += chunk;
  }
  if (projectRoot) {
    void trackUsage(projectRoot, {
      provider: provider?.name || 'unknown',
      model: model || provider?.defaultModel || null,
      promptTokens: Math.max(1, Math.ceil(JSON.stringify(messages || []).length / 4)),
      completionTokens: Math.max(1, Math.ceil(content.length / 4)),
      estimated: true,
    }).catch(() => {});
    void trackEvent(projectRoot, {
      type: 'provider.request',
      provider: provider?.name || 'unknown',
      model: model || provider?.defaultModel || null,
      promptTokens: Math.max(1, Math.ceil(JSON.stringify(messages || []).length / 4)),
      completionTokens: Math.max(1, Math.ceil(content.length / 4)),
    });
  }
  return content.trim();
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getTaskFolder(task) {
  return task?.folderPath || task?.folder || null;
}

function getAutoRunDir(taskFolder) {
  return path.join(normalizeRoot(taskFolder), AUTO_RUN_DIR_NAME);
}

function getCurrentAutoRunPath(taskFolder) {
  return path.join(normalizeRoot(taskFolder), CURRENT_AUTO_RUN_FILE);
}

async function ensureAutoRunWorkspace(taskFolder) {
  await fs.mkdir(getAutoRunDir(taskFolder), { recursive: true });
  return {
    autoRunDir: getAutoRunDir(taskFolder),
    currentAutoRunPath: getCurrentAutoRunPath(taskFolder),
  };
}

async function saveAutoRun(taskFolder, run) {
  const folder = normalizeRoot(taskFolder);
  await ensureAutoRunWorkspace(folder);
  const currentPath = getCurrentAutoRunPath(folder);
  const historyPath = path.join(getAutoRunDir(folder), `${run.runId}.json`);
  await writeJson(currentPath, run);
  await writeJson(historyPath, run);
  return run;
}

async function loadAutoRun(taskFolder, runId = null) {
  const folder = normalizeRoot(taskFolder);
  if (runId) {
    return readJson(path.join(getAutoRunDir(folder), `${runId}.json`));
  }
  const current = await readJson(getCurrentAutoRunPath(folder));
  if (current) {
    return current;
  }
  const entries = await fs.readdir(getAutoRunDir(folder), { withFileTypes: true }).catch(() => []);
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  if (!jsonFiles.length) {
    return null;
  }
  jsonFiles.sort((a, b) => b.name.localeCompare(a.name));
  return readJson(path.join(getAutoRunDir(folder), jsonFiles[0].name));
}

function ensureStepShape(step, index) {
  return {
    stepId: step.stepId || `step-${index + 1}`,
    title: String(step.title || step.name || `Step ${index + 1}`).trim(),
    description: String(step.description || '').trim(),
    files: Array.isArray(step.files) ? step.files.filter(Boolean) : [],
    status: step.status || 'pending',
    patch: step.patch || null,
    testResult: step.testResult || null,
    attempts: Number.isFinite(Number(step.attempts)) ? Number(step.attempts) : 0,
    completedAt: step.completedAt || null,
    error: step.error || null,
    patchId: step.patchId || null,
  };
}

async function buildPlanPrompt({ task, request, memorySummary, taskContext, conversationSummary, allowedShellCommands, projectRoot, locale = 'ru' }) {
  const instructions = locale === 'en'
    ? [
      'You are a task planner.',
      'Break the request into concrete atomic steps.',
      'Each step must be doable with one file patch and have a completion criterion.',
      'Return ONLY a valid JSON array with up to 10 steps.',
    ].join('\n')
    : [
      'Ты — планировщик задач.',
      'Разбей запрос на конкретные атомарные шаги.',
      'Каждый шаг должен быть выполним одним патчем и иметь критерий завершения.',
      'Верни ТОЛЬКО валидный JSON массив шагов, максимум 10.',
    ].join('\n');
  return [
    `=== ${instructions} ===`,
    `Request: ${request}`,
    `Task: ${task.title}`,
    projectRoot ? `Project root: ${projectRoot}` : null,
    allowedShellCommands?.length ? `Allowed shell commands: ${allowedShellCommands.join(', ')}` : null,
    '',
    'Project memory:',
    memorySummary || '—',
    '',
    'Task context:',
    taskContext || '—',
    '',
    'Conversation summary:',
    conversationSummary || '—',
  ].filter(Boolean).join('\n');
}

async function buildStepPrompt({ step, memorySummary, completedSteps, request, projectRoot, locale = 'ru' }) {
  const instructions = locale === 'en'
    ? 'You are an executor. Return ONLY valid JSON with a summary and file changes.'
    : 'Ты — исполнитель. Верни ТОЛЬКО валидный JSON со сводкой и файловыми изменениями.';
  return [
    `=== ${instructions} ===`,
    `Request: ${request}`,
    `Step: ${step.title}`,
    `Description: ${step.description}`,
    `Files: ${(step.files || []).join(', ') || '—'}`,
    projectRoot ? `Project root: ${projectRoot}` : null,
    '',
    'Completed steps:',
    completedSteps.length ? completedSteps.map((item) => `- ${item.title}`).join('\n') : '—',
    '',
    'Return format:',
    '{ "summary": "...", "changes": [{ "path": "src/file.js", "action": "update", "content": "..." }], "validationCommands": ["npm test"] }',
  ].filter(Boolean).join('\n');
}

function createRunRecord({ task, request, provider, model, retryMax, testCommand, steps }) {
  return {
    runId: createRunId(),
    taskId: task.id,
    request,
    provider: provider.name,
    model,
    status: 'running',
    startedAt: nowIso(),
    completedAt: null,
    plan: steps.map((step, index) => ensureStepShape(step, index)),
    summary: null,
    testCommand: testCommand || null,
    retryMax,
  };
}

function formatStepValidationCommands(testCommand, parsedValidationCommands) {
  const parsed = normalizeValidationCommands(parsedValidationCommands);
  if (parsed.length) {
    return parsed;
  }
  return normalizeValidationCommands(testCommand);
}

async function updateRunStep(taskFolder, runId, stepId, patch) {
  const run = await loadAutoRun(taskFolder, runId);
  if (!run) {
    return null;
  }
  const next = {
    ...run,
    updatedAt: nowIso(),
    plan: run.plan.map((step) => (step.stepId === stepId ? { ...step, ...patch } : step)),
  };
  await saveAutoRun(taskFolder, next);
  return next;
}

async function summarizePhase({ projectRoot = null, policy = null, provider, model, task, results, request, memorySummary, taskContext, locale = 'ru' }) {
  const prompt = locale === 'en'
    ? 'Summarize the auto run in concise Markdown. Include what changed, files, tests, and blockers.'
    : 'Сделай краткое Markdown-резюме auto run. Укажи что изменено, какие файлы, тесты и блокеры.';
  const messages = [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: [
        `Task: ${task.title}`,
        `Request: ${request}`,
        '',
        'Memory:',
        memorySummary || '—',
        '',
        'Task context:',
        taskContext || '—',
        '',
        'Results:',
        JSON.stringify(results, null, 2),
      ].join('\n'),
    },
  ];
  try {
    const text = await collectProviderText(projectRoot || null, provider, messages, model, { policy });
    return text || '';
  } catch {
    return [
      '# Auto run summary',
      '',
      `- Task: ${task.title}`,
      `- Request: ${request}`,
      `- Results: ${results.length} steps`,
    ].join('\n');
  }
}

export async function planPhase(taskId, request, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const provider = options.provider || await getProvider(projectRoot, options.providerName || options.provider || null);
  const model = options.model || provider.defaultModel;
  const memorySummary = options.memorySummary || await summarizeCurrentMemory(projectRoot);
  const taskContext = options.taskContext || await chooseTaskContext(task, null, options.locale || 'ru')(projectRoot);
  const conversationSummary = options.conversationSummary || '';
  const allowedShellCommands = options.allowedShellCommands || await listAllowedShellCommands(projectRoot);
  const retries = Number.isFinite(Number(options.retryMax)) ? Math.max(1, Number(options.retryMax)) : 3;
  const planMessages = [
    { role: 'system', content: await buildPlanPrompt({ task, request, memorySummary, taskContext, conversationSummary, allowedShellCommands, projectRoot, locale: options.locale || 'ru' }) },
    { role: 'user', content: request },
  ];

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await generatePatch({ projectRoot, provider, model, policy, messages: planMessages });
      const parsed = parseJsonPayload(response);
      if (!Array.isArray(parsed)) {
        throw new Error('Plan response must be a JSON array.');
      }
      return parsed.slice(0, Number(options.maxSteps) || 10).map((step, index) => ensureStepShape(step, index));
    } catch (error) {
      lastError = error;
      planMessages.push({
        role: 'user',
        content: `Retry ${attempt}/${retries}. Fix the JSON only. Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  throw lastError || new Error('Failed to generate plan.');
}

export async function executeStep(taskId, step, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const policy = options.policy || await readProjectPolicy(projectRoot);
  const provider = options.provider || await getProvider(projectRoot, options.providerName || null);
  const model = options.model || provider.defaultModel;
  const retryMax = Number.isFinite(Number(options.retryMax)) ? Math.max(1, Number(options.retryMax)) : 3;
  const request = options.request || task.userRequest || task.title;
  const completedSteps = Array.isArray(options.completedSteps) ? options.completedSteps : [];
  const taskDir = options.taskDir || path.dirname(options.taskFolderPath || task.folderPath || '');
  let lastError = null;

  for (let attempt = 1; attempt <= retryMax; attempt += 1) {
    const prompt = await buildStepPrompt({
      step,
      memorySummary: options.memorySummary || await summarizeCurrentMemory(projectRoot),
      completedSteps,
      request,
      projectRoot,
      locale: options.locale || 'ru',
    });
    try {
      const response = await generatePatch({
        projectRoot,
        provider,
        model,
        policy,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: request },
        ],
      });
      const parsed = parseJsonPayload(response);
      const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
      if (!changes.length) {
        throw new Error('Step response must include changes.');
      }

      const staged = await stageProjectPatch(projectRoot, {
        taskId,
        role: options.role || task.role || null,
        model,
        summary: String(parsed.summary || step.title || '').trim(),
        changes: changes.map((change) => ({
          path: change.path,
          action: change.action,
          afterContent: change.content ?? change.afterContent ?? '',
        })),
        validationCommands: options.noTests ? [] : formatStepValidationCommands(options.testCommand || null, parsed.validationCommands),
        policy: options.policy || await readProjectPolicy(projectRoot),
      });

      if (!staged.pending) {
        const result = {
          stepId: step.stepId,
          status: 'skipped',
          attempts: attempt,
          summary: parsed.summary || step.title,
          patchId: null,
          testResult: 'skipped',
        };
        if (options.runId) {
          void trackEvent(projectRoot, {
            type: 'auto.step',
            runId: options.runId,
            taskId,
            stepId: step.stepId,
            status: result.status,
          });
        }
        return result;
      }

      const applied = await applyPatchSilent(projectRoot, staged.pending, {
        policy: options.policy || await readProjectPolicy(projectRoot),
        t: options.t,
        skipTests: Boolean(options.noTests),
      });
      if (!applied.applied) {
        throw new Error(applied.reason || 'Patch application failed.');
      }

      const result = {
        stepId: step.stepId,
        status: 'completed',
        attempts: attempt,
        summary: String(parsed.summary || step.title).trim(),
        patchId: applied.patch.patchId,
        testResult: applied.validationResults.length
          ? (applied.validationResults.every((result) => result.ok || result.skipped) ? 'passed' : 'failed')
          : 'skipped',
        validationResults: applied.validationResults,
      };
      if (options.runId) {
        void trackEvent(projectRoot, {
          type: 'auto.step',
          runId: options.runId,
          taskId,
          stepId: step.stepId,
          status: result.status,
          patchId: result.patchId,
        });
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= retryMax) {
        const result = {
          stepId: step.stepId,
          status: 'failed',
          attempts: attempt,
          summary: step.title,
          patchId: null,
          error: error instanceof Error ? error.message : String(error),
          testResult: 'failed',
        };
        if (options.runId) {
          void trackEvent(projectRoot, {
            type: 'auto.step',
            runId: options.runId,
            taskId,
            stepId: step.stepId,
            status: result.status,
            error: result.error || null,
          });
        }
        return result;
      }
    }
  }

  const result = {
    stepId: step.stepId,
    status: 'failed',
    attempts: retryMax,
    summary: step.title,
    patchId: null,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    testResult: 'failed',
  };
  if (options.runId) {
    void trackEvent(projectRoot, {
      type: 'auto.step',
      runId: options.runId,
      taskId,
      stepId: step.stepId,
      status: result.status,
      error: result.error || null,
    });
  }
  return result;
}

export async function executePhase(taskId, steps, options = {}) {
  const results = [];
  for (const step of steps) {
    const result = await executeStep(taskId, step, {
      ...options,
      completedSteps: results,
    });
    results.push(result);
    if (result.status !== 'completed' && options.abortOnTestFail) {
      break;
    }
  }
  return results;
}

export async function reportPhase(taskId, runId, results, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const provider = options.provider || await getProvider(projectRoot, options.providerName || null);
  const model = options.model || provider.defaultModel;
  const memorySummary = options.memorySummary || await summarizeCurrentMemory(projectRoot);
  const taskContext = options.taskContext || await chooseTaskContext(task, null, options.locale || 'ru')(projectRoot);
  const summary = await summarizePhase({
    projectRoot,
    policy: options.policy || null,
    provider,
    model,
    task,
    results,
    request: options.request || task.userRequest || task.title,
    memorySummary,
    taskContext,
    locale: options.locale || 'ru',
  });
  if (summary) {
    await appendTaskNote(projectRoot, taskId, {
      kind: 'report',
      text: summary,
      source: 'auto-agent',
    }, { locale: options.locale || 'ru' });
  }
  await appendMessage(options.taskFolderPath || task.folderPath, {
    role: 'system',
    content: summary || 'Auto run completed.',
    provider: provider.name,
    model,
    sessionId: options.sessionId || null,
  });
  return summary;
}

export async function runAuto(taskId, request, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const policy = options.policy || await readProjectPolicy(projectRoot);
  const autoMode = options.autoMode || getAutoModeConfig(policy);
  if (!autoMode.enabled) {
    throw new Error('Auto mode is disabled by policy.');
  }
  const provider = options.provider || await getProvider(projectRoot, options.providerName || options.provider || null);
  const model = options.model || provider.defaultModel;
  if (Array.isArray(autoMode.allowedProviders) && autoMode.allowedProviders.length && !autoMode.allowedProviders.includes(provider.name)) {
    throw new Error(`Provider not allowed for auto mode: ${provider.name}`);
  }
  const taskFolderPath = task.folderPath || path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
  const sessionId = createSessionId();
  const memorySummary = options.memorySummary || await summarizeCurrentMemory(projectRoot);
  const taskContext = options.taskContext || await chooseTaskContext(task, null, options.locale || 'ru')(projectRoot);
  const conversation = options.conversation || (
    options.dryRun
      ? { summary: await readConversationSummary(taskFolderPath) }
      : await ensureConversationSummary(taskFolderPath, {
        provider,
        model,
        historyMessages: options.historyMessages || autoMode.historyMessages || 20,
        summarizeAfter: autoMode.summarizeAfter || 50,
        locale: options.locale || 'ru',
      })
  );
  const plan = Array.isArray(options.preplannedSteps) && options.preplannedSteps.length
    ? options.preplannedSteps.map((step, index) => ensureStepShape(step, index))
    : await planPhase(taskId, request, {
      projectRoot,
      provider,
      model,
      policy,
      retryMax: options.retryMax || autoMode.retryMax || 3,
      maxSteps: options.maxSteps || autoMode.maxSteps || 10,
      memorySummary,
      taskContext,
      conversationSummary: conversation.summary || '',
      allowedShellCommands: options.allowedShellCommands || await listAllowedShellCommands(projectRoot),
      locale: options.locale || 'ru',
    });

  const run = createRunRecord({
    task,
    request,
    provider,
    model,
    retryMax: options.retryMax || autoMode.retryMax || 3,
    testCommand: options.testCommand || autoMode.testCommand || null,
    steps: plan,
  });
  run.sessionId = sessionId;
  run.testOnEachStep = options.noTests ? false : (options.testOnEachStep ?? autoMode.testOnEachStep ?? true);
  run.abortOnTestFail = options.abortOnTestFail ?? autoMode.abortOnTestFail ?? false;
  run.provider = options.providerName || provider.name;

  if (options.dryRun) {
    return {
      run: {
        ...run,
        status: 'planned',
        updatedAt: nowIso(),
      },
      plan,
      results: [],
      summary: null,
      dryRun: true,
    };
  }

  await setCurrentTask(projectRoot, task.id, options.locale || 'ru');
  await saveAutoRun(taskFolderPath, run);
  await setTaskLastSessionId(projectRoot, task.id, sessionId, options.locale || 'ru');
  void trackEvent(projectRoot, {
    type: 'auto.started',
    runId: run.runId,
    taskId: task.id,
    provider: provider.name,
    model,
    stepCount: run.plan.length,
  });
  await appendMessage(taskFolderPath, {
    role: 'system',
    content: [
      `Auto run started: ${run.runId}`,
      `Request: ${request}`,
      `Steps: ${run.plan.length}`,
    ].join('\n'),
    provider: provider.name,
    model,
    sessionId,
  });

  const results = [];
  for (const step of run.plan.slice(0, Number(options.maxSteps) || autoMode.maxSteps || 10)) {
    const result = await executeStep(task.id, step, {
      projectRoot,
      provider,
      model,
      policy,
      retryMax: options.retryMax || autoMode.retryMax || 3,
      noTests: options.noTests,
      testCommand: options.testCommand || autoMode.testCommand || null,
      request,
      memorySummary,
      taskFolderPath,
      locale: options.locale || 'ru',
      completedSteps: results,
      runId: run.runId,
    });
    results.push(result);
    await updateRunStep(taskFolderPath, run.runId, step.stepId, {
      ...result,
      status: result.status,
      attempts: result.attempts,
      patch: result.patchId ? `${result.patchId}.diff` : null,
      completedAt: result.status === 'completed' ? nowIso() : null,
    });
    if (result.status !== 'completed' && run.abortOnTestFail) {
      break;
    }
    if (options.abortSignal?.aborted) {
      break;
    }
  }

  const summary = await reportPhase(task.id, run.runId, results, {
    projectRoot,
    policy,
    provider,
    model,
    request,
    memorySummary,
    taskContext,
    taskFolderPath,
    sessionId,
    locale: options.locale || 'ru',
  });

  const completedRun = {
    ...(await loadAutoRun(taskFolderPath, run.runId)),
    status: 'completed',
    completedAt: nowIso(),
    summary,
    results,
  };
  await saveAutoRun(taskFolderPath, completedRun);
  void trackEvent(projectRoot, {
    type: 'auto.completed',
    runId: run.runId,
    taskId: task.id,
    provider: provider.name,
    model,
    stepCount: results.length,
  });

  return {
    run: completedRun,
    plan,
    results,
    summary,
  };
}

export async function getRunStatus(taskId, runId, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const taskFolderPath = task.folderPath || path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
  const run = await loadAutoRun(taskFolderPath, runId);
  return run;
}

export async function abortRun(taskId, runId, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const taskFolderPath = task.folderPath || path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
  const run = await loadAutoRun(taskFolderPath, runId);
  if (!run) {
    return { aborted: false, reason: 'run_not_found' };
  }
  const latestStep = [...(run.plan || [])].reverse().find((step) => step.status === 'running' || step.status === 'completed');
  if (latestStep?.patchId) {
    const patchStatus = await getPatchStatus(projectRoot);
    const currentPatch = patchStatus.latest && patchStatus.latest.patchId === latestStep.patchId ? patchStatus.latest : null;
    if (currentPatch && currentPatch.status === 'pending') {
      await rollbackPatch(projectRoot, currentPatch);
    }
  }
  const nextRun = {
    ...run,
    status: 'aborted',
    updatedAt: nowIso(),
    completedAt: nowIso(),
  };
  await saveAutoRun(taskFolderPath, nextRun);
  await appendMessage(taskFolderPath, {
    role: 'system',
    content: `Auto run aborted: ${run.runId}`,
    provider: run.provider || 'system',
    model: run.model || null,
    sessionId: run.sessionId || null,
  });
  void trackEvent(projectRoot, {
    type: 'auto.aborted',
    runId: run.runId,
    taskId: task.id,
    provider: run.provider || 'unknown',
    model: run.model || null,
  });
  return { aborted: true, run: nextRun };
}

export async function listRuns(taskId, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || process.cwd());
  const task = await resolveTask(projectRoot, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const taskFolderPath = task.folderPath || path.join(projectRoot, '.local-codex', 'tasks', task.location || 'active', task.id);
  const runDir = getAutoRunDir(taskFolderPath);
  const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => []);
  const runs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const run = await readJson(path.join(runDir, entry.name));
    if (run) {
      runs.push(run);
    }
  }
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return runs;
}
