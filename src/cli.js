#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { access, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { openProject, formatProjectTree } from './project.js';
import { runInteractiveAgent } from './agent.js';
import { createTranslator, normalizeLocaleCode } from './i18n.js';
import { listAllowedShellCommands } from './shell.js';
import {
  createRoleProfile,
  formatRoleProfile,
  getBuiltinRoleNamesList,
  getResolvedRoleName,
  getRoleFileLocation,
  listRoleProfiles,
  loadRoleProfile,
  scaffoldBuiltInRoles,
  setActiveRole,
  resolveRoleSelection,
} from './roles.js';
import {
  ensureProjectMemory,
  getProjectMemoryStatus,
  listMemoryModuleSummaries,
  rebuildProjectMemory,
  refreshProjectMemory,
  summarizeCurrentMemory,
  showMemoryEntry,
  readProjectState,
  updateProjectState,
} from './memory.js';
import { ensureProjectPolicy, getPolicyPath, readProjectPolicy, writeProjectPolicy } from './policy.js';
import {
  ensureTaskWorkspace,
  createTask,
  listTasks,
  showTask,
  getCurrentTask,
  setCurrentTask,
  setTaskLastSessionId,
  generateTaskPlan,
  appendTaskNote,
  markTaskDone,
  archiveTask,
  getTaskWorkspaceStatus,
  getCurrentTaskContext,
  resolveTask,
  getTaskWorkspaceRoot,
} from './tasks.js';
import {
  ensureExtensionsWorkspace,
  describeExtension,
  listExtensions,
  listInstalledExtensions,
  loadExtensions,
  previewExtensionInstall,
  removeLoadedExtension,
  runExtensionCommand,
  installExtension,
  removeExtension,
  scaffoldExtension,
  updateExtension,
  inspectExtension,
  doctorExtensions,
  enableExtension,
  disableExtension,
  setLoadedExtensionEnabled,
  listEnabledExtensionPromptPacks,
} from './extensions.js';
import {
  addRegistrySource,
  doctorRegistryCatalog,
  getRegistryCatalog,
  getRegistryEntry,
  installRegistryEntry,
  refreshRegistryCatalog,
  removeRegistrySource,
  ensureRegistryWorkspace,
} from './registry.js';
import { prepareProjectWorkspace } from './workspace-bootstrap.js';
import {
  ensureProvidersWorkspace,
  getContextWindowConfig,
  getProvider,
  listProviderSummaries,
  listProviderModels,
  setProviderFallback,
  setProviderApiKey,
  setProviderModel,
  useProvider,
} from './providers/index.js';
import {
  addWorkspace,
  getCurrentWorkspace,
  getWorkspaceConfigPath,
  initGlobal as initGlobalWorkspace,
  listWorkspaces,
  pinWorkspace,
  readGlobalConfig,
  refreshSnapshot as refreshWorkspaceSnapshot,
  removeWorkspace,
  renameWorkspace,
  repairWorkspaces,
  searchWorkspaces,
  switchWorkspace,
  tagWorkspace,
  writeGlobalConfig,
} from './workspace.js';
import { BASE_SYSTEM_INSTRUCTIONS, composePromptLayers, formatPromptInspection } from './prompt-composer.js';
import { setProjectFreezeMode } from './freeze-mode.js';
import {
  abortRun as abortAutoRun,
  getRunStatus as getAutoRunStatus,
  listRuns as listAutoRuns,
  planPhase as planAutoPhase,
  runAuto as runAutoAgent,
} from './auto-agent.js';
import {
  detectRunner,
  getHistory as getTestRunHistory,
  getTestRunLogPath,
  getTestRunnerConfig,
  pruneHistory as pruneTestRunHistory,
  readTestRunLog,
  runConfiguredTests,
  runTests,
  updatePolicyWithDetectedRunner,
} from './test-runner.js';
import {
  dropIndex,
  getIndexStatus,
  indexAll,
  indexCode,
  indexIncremental,
  indexMemory,
  prepareEmbeddingProvider,
  rebuildIndex,
} from './indexer.js';
import { semanticSearch, formatResults } from './search.js';
import {
  formatStatsReport,
  getStats,
  pruneEvents,
  refreshStats,
} from './stats.js';
import {
  checkLimit as checkBudgetLimit,
  exportCSV as exportBudgetCSV,
  formatReport as formatBudgetReport,
  formatTokens as formatBudgetTokens,
  getCache as getBudgetCache,
  listUsageEntries as listBudgetUsageEntries,
  pruneUsage as pruneBudgetUsage,
  refreshCache as refreshBudgetCache,
  summarizeByModel as summarizeBudgetByModel,
} from './budget.js';
import {
  addHook,
  getHookHistory as getHooksHistory,
  initHooks,
  listHooks,
  setHookEnabled,
  setupTelegramHook,
  testHook,
} from './hooks.js';
import {
  appendMessage as appendConversationMessage,
  clearHistory as clearConversationHistory,
  createMessageId,
  createSessionId,
  exportToJson as exportConversationToJson,
  exportToMarkdown as exportConversationToMarkdown,
  listConversationStats,
  listSessions as listConversationSessions,
  prepareConversationContext,
  readConversationSummary,
  readHistory as readConversationHistory,
  readRecent as readRecentConversationMessages,
  readSession as readConversationSession,
} from './conversation.js';
import {
  applyPatchArtifact,
  formatPatchDiff,
  formatPatchStatus,
  getPatchStatus,
  getPendingPatch,
  rejectPatchArtifact,
} from './patches.js';
import {
  getServerConfig,
  getServerStatus,
  startServer,
  stopServer,
} from './server.js';

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--model') {
      options.model = argv[++i];
      continue;
    }
    if (value === '--provider') {
      options.provider = argv[++i];
      continue;
    }
    if (value === '--role') {
      options.role = argv[++i];
      continue;
    }
    if (value === '--alias') {
      options.alias = argv[++i];
      continue;
    }
    if (value === '--global') {
      options.global = true;
      continue;
    }
    if (value === '--tag') {
      options.tags = options.tags || [];
      options.tags.push(argv[++i]);
      continue;
    }
    if (value === '--pin') {
      options.pin = true;
      continue;
    }
    if (value === '--sort') {
      options.sort = argv[++i];
      continue;
    }
    if (value === '--set') {
      options.set = argv[++i];
      continue;
    }
    if (value === '--depth') {
      options.depth = Number(argv[++i]);
      continue;
    }
    if (value === '--limit') {
      options.limit = Number(argv[++i]);
      continue;
    }
    if (value === '--days') {
      options.days = Number(argv[++i]);
      continue;
    }
    if (value === '--period') {
      options.period = argv[++i];
      continue;
    }
    if (value === '--section') {
      options.section = argv[++i];
      continue;
    }
    if (value === '--target') {
      options.target = argv[++i];
      continue;
    }
    if (value === '--from') {
      options.from = argv[++i];
      continue;
    }
    if (value === '--to') {
      options.to = argv[++i];
      continue;
    }
    if (value === '--json') {
      options.json = true;
      continue;
    }
    if (value === '--keep-days') {
      options.keepDays = Number(argv[++i]);
      continue;
    }
    if (value === '--daily') {
      options.daily = argv[++i];
      continue;
    }
    if (value === '--weekly') {
      options.weekly = argv[++i];
      continue;
    }
    if (value === '--monthly') {
      options.monthly = argv[++i];
      continue;
    }
    if (value === '--task') {
      options.task = argv[++i];
      continue;
    }
    if (value === '--session') {
      options.session = argv[++i];
      continue;
    }
    if (value === '--run-id') {
      options.runId = argv[++i];
      continue;
    }
    if (value === '--title') {
      options.title = argv[++i];
      continue;
    }
    if (value === '--request') {
      options.request = argv[++i];
      continue;
    }
    if (value === '--name') {
      options.name = argv[++i];
      continue;
    }
    if (value === '--id') {
      options.id = argv[++i];
      continue;
    }
    if (value === '--channel') {
      options.channel = argv[++i];
      continue;
    }
    if (value === '--hooks') {
      options.hooks = argv[++i];
      continue;
    }
    if (value === '--on') {
      options.on = argv[++i];
      continue;
    }
    if (value === '--message') {
      options.message = argv[++i];
      continue;
    }
    if (value === '--command') {
      options.command = argv[++i];
      continue;
    }
    if (value === '--url') {
      options.url = argv[++i];
      continue;
    }
    if (value === '--method') {
      options.method = argv[++i];
      continue;
    }
    if (value === '--body') {
      options.body = argv[++i];
      continue;
    }
    if (value === '--token') {
      options.token = argv[++i];
      continue;
    }
    if (value === '--chat-id') {
      options.chatId = argv[++i];
      continue;
    }
    if (value === '--summary') {
      options.summary = argv[++i];
      continue;
    }
    if (value === '--path') {
      options.path = argv[++i];
      continue;
    }
    if (value === '--output') {
      options.output = argv[++i];
      continue;
    }
    if (value === '--ref') {
      options.ref = argv[++i];
      continue;
    }
    if (value === '--kind') {
      options.kind = argv[++i];
      continue;
    }
    if (value === '--text') {
      options.text = argv[++i];
      continue;
    }
    if (value === '--command') {
      options.command = argv[++i];
      continue;
    }
    if (value === '--reason') {
      options.reason = argv[++i];
      continue;
    }
    if (value === '--port') {
      options.port = Number(argv[++i]);
      continue;
    }
    if (value === '--host') {
      options.host = argv[++i];
      continue;
    }
    if (value === '--cwd') {
      options.cwd = argv[++i];
      continue;
    }
    if (value === '--format') {
      options.format = argv[++i];
      continue;
    }
    if (value === '--file') {
      options.files = options.files || [];
      options.files.push(argv[++i]);
      continue;
    }
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    if (value === '--yes' || value === '-y') {
      options.yes = true;
      continue;
    }
    if (value === '--clear') {
      options.clear = true;
      continue;
    }
    if (value === '--pinned') {
      options.pinned = true;
      options.pin = true;
      continue;
    }
    if (value === '--confirm') {
      options.confirm = true;
      continue;
    }
    if (value === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (value === '--force') {
      options.force = true;
      continue;
    }
    if (value === '--open') {
      options.open = true;
      continue;
    }
    if (value === '--no-open') {
      options.open = false;
      continue;
    }
    if (value === '--no-tests') {
      options.noTests = true;
      continue;
    }
    if (value === '--max-steps') {
      options.maxSteps = Number(argv[++i]);
      continue;
    }
    if (value === '--timeout') {
      options.timeout = Number(argv[++i]);
      continue;
    }
    if (value === '--retry-max') {
      options.retryMax = Number(argv[++i]);
      continue;
    }
    if (value === '--status') {
      options.status = argv[++i];
      continue;
    }
    if (value === '--source') {
      options.source = argv[++i];
      continue;
    }
    if (value === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (value === '--min-score') {
      options.minScore = Number(argv[++i]);
      continue;
    }
    if (value === '--test-command') {
      options.testCommand = argv[++i];
      continue;
    }
    if (value === '--abort-on-test-fail') {
      options.abortOnTestFail = true;
      continue;
    }
    options._.push(value);
  }
  return options;
}

function formatDate(value, locale) {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(size) : Number(size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2));
  return `${rounded} ${units[unit]}`;
}

function formatIndexTableRow(info) {
  const updatedAt = info?.updatedAt ? new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(info.updatedAt)) : '—';
  return `${info?.tableName || '—'}   ${info?.totalChunks || 0} чанков   ${info?.embeddingModel || '—'}   ${updatedAt}`;
}

function normalizeIndexTarget(value) {
  const target = String(value || 'all').trim().toLowerCase();
  if (['memory', 'code', 'all'].includes(target)) {
    return target;
  }
  return 'all';
}

function normalizeSearchSource(value) {
  const source = String(value || 'all').trim().toLowerCase();
  if (['memory', 'code', 'all'].includes(source)) {
    return source;
  }
  return 'all';
}

function deriveTaskTitle(taskText) {
  const firstLine = String(taskText || '')
    .split(/\r?\n/, 1)[0]
    .trim()
    .replace(/[.!?…]+$/u, '');
  if (!firstLine) {
    return 'Новая задача';
  }
  return firstLine.split(/\s+/).slice(0, 8).join(' ').slice(0, 64);
}

function printUsage(t) {
  console.log(`${t('help.title')}\n\n${t('help.usage')}\n\n${t('help.examples')}`);
}

function formatRelativeTime(value, locale = 'ru') {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const diffMs = date.getTime() - Date.now();
  const diffAbs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diffAbs < minute) {
    return locale.startsWith('ru') ? 'сейчас' : 'just now';
  }
  if (diffAbs < hour) {
    return rtf.format(Math.round(diffMs / minute), 'minute');
  }
  if (diffAbs < day) {
    return rtf.format(Math.round(diffMs / hour), 'hour');
  }
  return rtf.format(Math.round(diffMs / day), 'day');
}

function formatWorkspaceSnapshot(workspace, locale) {
  const snapshot = workspace.snapshot || {};
  const providerModel = [snapshot.provider || workspace.provider || '—', snapshot.model || workspace.model || '—'].join('/');
  const role = snapshot.role || workspace.role || '—';
  const task = snapshot.activeTask || workspace.activeTask || '—';
  const taskCount = Number.isFinite(snapshot.taskCount) ? snapshot.taskCount : 0;
  return `${providerModel}  Роль: ${role}  Задача: ${task}  ${taskCount} задач  ${formatRelativeTime(workspace.lastOpenedAt, locale)}`;
}

function printWorkspaceLine(workspace, locale) {
  const marker = workspace.current ? '→' : workspace.pinned ? '📌' : ' ';
  const availability = workspace.available === false ? ' [недоступен]' : '';
  console.log(`${marker} ${workspace.alias}${workspace.name && workspace.name !== workspace.alias ? ` — ${workspace.name}` : ''}${availability}`);
  console.log(`  ${workspace.path}`);
  console.log(`  ${formatWorkspaceSnapshot(workspace, locale)}`);
}

function printWorkspaceCompact(workspace, locale) {
  const marker = workspace.current ? '→' : workspace.pinned ? '📌' : ' ';
  const availability = workspace.available === false ? ' [недоступен]' : '';
  console.log(`${marker} ${workspace.alias}${availability}   ${workspace.path}   ${formatWorkspaceSnapshot(workspace, locale)}`);
}

async function promptWorkspaceSelection(workspaces, t, locale) {
  if (!workspaces.length) {
    return null;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return workspaces[0] || null;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log(t('workspace.selectTitle'));
    workspaces.forEach((workspace, index) => {
      const marker = workspace.current ? '→' : workspace.pinned ? '📌' : ' ';
      const summary = workspace.available === false ? ' [недоступен]' : '';
      console.log(`  ${index + 1}. ${marker} ${workspace.alias}${summary} — ${workspace.path}`);
    });
    const answer = await rl.question(`${t('workspace.selectPrompt')} `);
    const trimmed = String(answer || '').trim();
    if (!trimmed) {
      return null;
    }
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index) && index >= 1 && index <= workspaces.length) {
      return workspaces[index - 1];
    }
    return workspaces.find((workspace) => workspace.alias === trimmed) || null;
  } finally {
    rl.close();
  }
}

function parseWorkspaceConfigPatch(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const [key, ...rest] = raw.split('=');
  if (!key || !rest.length) {
    return null;
  }
  const normalizedKey = key.trim();
  const normalizedValue = rest.join('=').trim();
  if (!normalizedKey) {
    return null;
  }
  if (normalizedValue === 'true' || normalizedValue === 'false') {
    return { [normalizedKey]: normalizedValue === 'true' };
  }
  if (Number.isFinite(Number(normalizedValue)) && normalizedValue !== '') {
    return { [normalizedKey]: Number(normalizedValue) };
  }
  return { [normalizedKey]: normalizedValue };
}

async function runProjectStart(projectPath, options, t, locale) {
  const project = await openProject(projectPath);
  await prepareProjectWorkspace(project.root, { scaffoldRoles: true });
  await addWorkspace(project.root, {
    alias: options.alias || undefined,
    tags: options.tags || [],
    pin: options.pin === true ? true : options.pin === false ? false : undefined,
  });

  const state = await readProjectState(project.root);
  const policy = await readProjectPolicy(project.root);
  const selectedProvider = await getProvider(project.root, options.provider || state?.selectedProvider || null);
  const model = options.model || state?.selectedModel || selectedProvider.defaultModel;
  const resolvedRole = await resolveRoleSelection(project.root, options.role || state?.activeRole || null);
  let currentTask = await getCurrentTask(project.root);
  const initialTaskInstruction = String(options.task || '').trim();
  if (initialTaskInstruction) {
    const createdTask = await createTask(project.root, {
      title: deriveTaskTitle(initialTaskInstruction),
      userRequest: initialTaskInstruction,
      summary: initialTaskInstruction,
      role: resolvedRole.name,
      model,
    }, locale);
    await setCurrentTask(project.root, createdTask.id, locale);
    currentTask = await getCurrentTask(project.root);
  }
  const sessionId = createSessionId();
  const conversation = await loadConversationBundle(project.root, currentTask, {
    provider: selectedProvider,
    model,
    locale,
  });
  const statePatch = {
    activeRole: resolvedRole.name,
    currentTaskId: currentTask?.id || null,
  };
  if (!options.provider && !options.model) {
    statePatch.selectedProvider = selectedProvider.name;
    statePatch.selectedModel = model;
  }
  await updateProjectState(project.root, statePatch);
  if (currentTask) {
    await setTaskLastSessionId(project.root, currentTask.id, sessionId, locale);
  }

  const memoryContext = await summarizeCurrentMemory(project.root);
  const taskContext = currentTask ? await getCurrentTaskContext(project.root, locale) : '';
  const extensionPrompts = await listEnabledExtensionPromptPacks(project.root);
  const allowedShellCommands = await listAllowedShellCommands(project.root);
  console.log(t('project.loaded', { path: project.root }));
  console.log(t('project.workspacePrepared'));
  console.log(t('project.readyHint'));
  console.log(`${t('common.projectRoot')}: ${project.root}`);
  console.log(t('common.selectedProvider', { provider: selectedProvider.name }));
  console.log(t('common.activeRole', { role: resolvedRole.name }));
  console.log(t('common.selectedModel', { model }));
  console.log(t('common.currentTask', { id: currentTask ? `${currentTask.id} (${currentTask.title})` : t('common.notSet') }));
  if (conversation.totalMessages > 0) {
    console.log(t('task.continueLoaded', {
      messages: conversation.totalMessages,
      sessions: conversation.sessionCount,
      limit: conversation.contextWindow?.historyMessages || 20,
    }));
  }
  if (initialTaskInstruction && currentTask) {
    console.log(t('agent.taskStarted', { id: currentTask.id, title: currentTask.title }));
  }
  if (conversation.summaryGenerated) {
    console.log(t('task.conversationSummaryGenerated'));
  }

  await runInteractiveAgent({
    root: project.root,
    model,
    provider: selectedProvider,
    promptLabel: t('agent.promptLabel'),
    exitHint: t('agent.exitHint'),
    helpHint: t('agent.helpHint'),
    initialUserInput: initialTaskInstruction,
    initialConversationHistory: conversation.recentMessages,
    composePromptForTask: async (taskInstruction) => composePromptLayers({
      baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
      roleProfile: resolvedRole,
      memorySummary: memoryContext,
      taskContext,
      conversationSummary: conversation.summary,
      extensionPrompts,
      taskInstruction,
      allowedShellCommands,
      projectRoot: project.root,
      policy,
    }),
    policy,
    t,
    taskTools: currentTask ? {
      currentTaskId: currentTask.id,
      currentRole: resolvedRole.name,
      currentModel: model,
      currentSessionId: sessionId,
      appendNote: async ({ taskId, kind, text, source }) => appendTaskNote(project.root, taskId, {
        kind,
        text,
        source,
      }, { locale }),
      onTurnComplete: async ({ userInput, assistantMessage, toolResults }) => {
        const pieces = [];
        const taskDir = getTaskFolderPath(project.root, currentTask);
        if (userInput) {
          await appendConversationMessage(taskDir, {
            id: createMessageId(),
            role: 'user',
            content: userInput,
            timestamp: new Date().toISOString(),
            provider: selectedProvider.name,
            model,
            sessionId,
          });
          pieces.push(`Запрос: ${userInput}`);
        }
        if (assistantMessage) {
          await appendConversationMessage(taskDir, {
            id: createMessageId(),
            role: 'assistant',
            content: assistantMessage,
            timestamp: new Date().toISOString(),
            provider: selectedProvider.name,
            model,
            sessionId,
          });
          pieces.push(`Ответ: ${assistantMessage}`);
        }
        if (toolResults.length) {
          pieces.push(`Инструменты: ${toolResults.map(({ call }) => call.tool).join(', ')}`);
        }
        const noteText = pieces.join('\n');
        if (noteText.trim()) {
          await appendTaskNote(project.root, currentTask.id, {
            kind: toolResults.some(({ call }) => call.tool === 'run_shell') ? 'validation result' : 'finding',
            text: noteText.slice(0, 1200),
            source: 'agent',
          }, { locale });
        }
        await setTaskLastSessionId(project.root, currentTask.id, sessionId, locale);
      },
    } : {
      onTurnComplete: async () => {},
    },
  });
}

function printRoleSummary(profile, t, { active = false } = {}) {
  const marker = active ? `* ${t('roles.activeMarker')}` : ' ';
  console.log(`${marker} ${profile.name} - ${profile.description}`);
  console.log(`  ${t('common.file')}: ${profile.filePath}`);
}

function printTaskList(tasks, formatTaskSummary, emptyMessage) {
  if (!tasks.length) {
    console.log(emptyMessage);
    return;
  }
  for (const task of tasks) {
    console.log(formatTaskSummary(task));
    console.log('');
  }
}

function formatPatchStateLabel(t, status) {
  const map = {
    pending: t('patch.statusPending'),
    applied: t('patch.statusApplied'),
    rejected: t('patch.statusRejected'),
    conflict: t('patch.statusConflict'),
  };
  return map[status] || status;
}

function formatExtensionStatusLabel(t, enabled) {
  return enabled ? t('extensions.statusEnabled') : t('extensions.statusDisabled');
}

function formatProviderStatusLabel(t, enabled) {
  return enabled ? t('provider.statusEnabled') : t('provider.statusDisabled');
}

function formatProviderHealthLabel(t, health) {
  if (!health) {
    return t('provider.healthUnknown');
  }
  if (health.code === 'disabled') {
    return t('provider.healthDisabled');
  }
  if (health.ok) {
    return t('provider.healthOk');
  }
  return t('provider.healthFailed', { reason: health.error || health.message || t('common.notSet') });
}

function getTaskFolderPath(projectRoot, task) {
  if (!task) {
    return null;
  }
  return path.join(getTaskWorkspaceRoot(projectRoot), task.location || 'active', task.id);
}

function formatConversationSpeaker(role) {
  switch (role) {
    case 'assistant':
      return '🤖';
    case 'system':
      return '🛠️';
    default:
      return '👤';
  }
}

function formatConversationMessage(message, locale) {
  return [
    `[${formatDate(message.timestamp, locale)}] ${formatConversationSpeaker(message.role)} ${message.content}`,
  ].join('\n');
}

function formatSessionSummary(session, locale) {
  const providers = session.providers.length ? session.providers.join(', ') : '—';
  const models = session.models.length ? session.models.join(', ') : '—';
  return [
    `${session.sessionId}   ${formatDate(session.startedAt, locale)}   ${session.messageCount} ${locale === 'ru' ? 'сообщений' : 'messages'}   ${providers}/${models}`,
  ].join('\n');
}

function formatAutoRunStep(step, locale, t) {
  const status = String(step.status || 'pending');
  const iconMap = {
    completed: '✅',
    running: '🔄',
    failed: '❌',
    skipped: '⏭',
    pending: '⏳',
  };
  const statusLabel = {
    completed: t('task.autoStepCompleted', { attempts: step.attempts || 1 }),
    running: t('task.autoStepRunning'),
    failed: t('task.autoStepFailed', { error: step.error || t('common.notSet') }),
    skipped: t('task.autoStepSkipped'),
    pending: t('task.autoStepPending'),
  }[status] || status;
  return `${iconMap[status] || '•'} ${step.stepId}: ${step.title} — ${statusLabel}`;
}

function formatAutoRunStatus(run, task, locale, t) {
  if (!run) {
    return t('task.autoRunNotFound');
  }
  const steps = Array.isArray(run.plan) ? run.plan : [];
  const completed = steps.filter((step) => step.status === 'completed').length;
  const runningIndex = steps.findIndex((step) => step.status === 'running');
  const stateLabel = {
    planned: t('task.autoRunPlanned'),
    running: runningIndex >= 0
      ? t('task.autoRunRunning', { current: runningIndex + 1, total: steps.length || run.plan?.length || 0 })
      : t('task.autoRunRunningGeneric'),
    aborted: t('task.autoRunAborted'),
    completed: t('task.autoRunCompleted'),
  }[run.status] || run.status;
  return [
    t('task.autoRunTitle', { runId: run.runId }),
    `${t('task.request')}: ${run.request || task?.userRequest || t('common.notSet')}`,
    `${t('task.currentTitle')}: ${task ? `${task.id}${task.title ? ` (${task.title})` : ''}` : t('common.notSet')}`,
    `${t('task.status')}: ${stateLabel}`,
    `${t('task.autoRunProvider')}: ${run.provider || t('common.notSet')}`,
    `${t('task.model')}: ${run.model || t('common.notSet')}`,
    `${t('task.autoRunSession')}: ${run.sessionId || t('common.notSet')}`,
    `${t('task.autoRunSteps')}: ${completed}/${steps.length}`,
    '',
    ...steps.map((step) => formatAutoRunStep(step, locale, t)),
  ].join('\n');
}

function formatAutoPlan(plan, request, locale, t) {
  const lines = [
    t('task.autoPlanTitle', { request }),
    '────────────────────────────────',
  ];
  for (const [index, step] of plan.entries()) {
    lines.push(`${index + 1}. ${step.title}`);
    if (step.description) {
      lines.push(`   ${step.description}`);
    }
    if (Array.isArray(step.files) && step.files.length) {
      lines.push(`   ${t('task.autoStepFiles')}: ${step.files.join(', ')}`);
    }
  }
  lines.push('');
  lines.push(t('task.autoPlanCount', { count: plan.length }));
  return lines.join('\n');
}

function formatTestSummary(run, t, locale) {
  const summary = run.summary || {};
  const total = Number.isFinite(summary.total) ? summary.total : ((summary.passed || 0) + (summary.failed || 0) + (summary.skipped || 0));
  const passed = Number.isFinite(summary.passed) ? summary.passed : 0;
  const failed = Number.isFinite(summary.failed) ? summary.failed : 0;
  const skipped = Number.isFinite(summary.skipped) ? summary.skipped : 0;
  const duration = Number.isFinite(run.duration) ? `${(run.duration / 1000).toFixed(1)}s` : '—';
  const statusLabel = t(`test.status.${run.status}`);
  return [
    `${run.runId}   ${formatDate(run.startedAt, locale)}   ${statusLabel}   ${passed}/${total || passed + failed + skipped}   ${duration}   ${run.patchId || '—'}`,
  ].join('\n');
}

function formatTestRunDetails(run, t, locale) {
  const summary = run.summary || {};
  const lines = [
    `${t('test.runTitle')}: ${run.runId}`,
    `${t('common.currentTask')}: ${run.taskId || t('common.notSet')}`,
    `${t('test.command')}: ${run.command || t('common.notSet')}`,
    `${t('test.runner')}: ${run.runner || t('common.notSet')}`,
    `${t('test.statusLabel')}: ${t(`test.status.${run.status}`)}`,
    `${t('test.duration')}: ${Number.isFinite(run.duration) ? `${(run.duration / 1000).toFixed(1)}s` : '—'}`,
    `${t('test.summary')}: ${Number.isFinite(summary.passed) ? summary.passed : 0}/${Number.isFinite(summary.total) ? summary.total : 0} (${Number.isFinite(summary.failed) ? summary.failed : 0} failed)`,
    '',
    run.output || t('test.noOutput'),
  ];
  if (Array.isArray(run.failedTests) && run.failedTests.length) {
    lines.push('');
    lines.push(t('test.failedTests'));
    for (const item of run.failedTests) {
      lines.push(`- ${item.name}${item.error ? `: ${item.error}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatTestRunnerConfig(config, t) {
  const runners = Array.isArray(config.runners) ? config.runners : [];
  const lines = [
    `${t('test.configTitle')}`,
    `${t('test.command')}: ${config.command || t('common.notSet')}`,
    `${t('test.cwd')}: ${config.cwd || t('common.notSet')}`,
    `${t('test.timeout')}: ${Number.isFinite(config.timeout) ? `${Math.floor(config.timeout / 1000)}s` : '—'}`,
    `${t('test.autoRunOnPatchApply')}: ${config.autoRun?.onPatchApply ? t('common.yes') : t('common.no')}`,
    `${t('test.autoRunOnAutoStep')}: ${config.autoRun?.onAutoStep ? t('common.yes') : t('common.no')}`,
    `${t('test.onFail')}: ${config.onFail?.action || t('common.notSet')}`,
    `${t('test.historyKeepLast')}: ${config.history?.keepLast || t('common.notSet')}`,
  ];
  if (runners.length) {
    lines.push(t('test.runnersTitle'));
    for (const runner of runners) {
      lines.push(`- ${runner.name || 'runner'}: ${runner.command}${runner.cwd ? ` (cwd: ${runner.cwd})` : ''}`);
    }
  }
  return lines.join('\n');
}

async function resolveConversationExportPath(projectRoot, task, format, output) {
  const extension = format === 'json' ? 'json' : 'md';
  const defaultName = `task-${task.slug || task.id}-history.${extension}`;
  if (!output) {
    return path.join(projectRoot, defaultName);
  }
  const resolved = path.resolve(projectRoot, output);
  const stats = await fsStatIfExists(resolved);
  if (stats?.isDirectory()) {
    return path.join(resolved, defaultName);
  }
  if (path.extname(resolved)) {
    return resolved;
  }
  return path.join(resolved, defaultName);
}

async function fsStatIfExists(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function loadConversationBundle(projectRoot, task, { provider, model, locale }) {
  if (!task) {
    return {
      summary: '',
      recentMessages: [],
      totalMessages: 0,
      sessionCount: 0,
      summaryGenerated: false,
      contextWindow: null,
      conversationPath: null,
    };
  }
  const contextWindow = await getContextWindowConfig(projectRoot);
  const taskDir = getTaskFolderPath(projectRoot, task);
  const bundle = await prepareConversationContext(taskDir, {
    provider,
    model,
    historyMessages: contextWindow.historyMessages,
    summarizeAfter: contextWindow.summarizeAfter,
    locale,
  });
  return {
    ...bundle,
    contextWindow,
    taskDir,
    conversationPath: taskDir ? path.join(taskDir, 'conversation.jsonl') : null,
  };
}

function printProviderSummary(entry, t) {
  console.log(`${entry.selected ? '●' : '◦'} ${entry.name}`);
  console.log(`  ${t('provider.status')}: ${formatProviderStatusLabel(t, entry.enabled)}`);
  console.log(`  ${t('provider.defaultModel')}: ${entry.model || entry.defaultModel || t('common.notSet')}`);
  console.log(`  ${t('provider.health')}: ${formatProviderHealthLabel(t, entry.health)}`);
  if (entry.baseUrl) {
    console.log(`  ${t('provider.baseUrl')}: ${entry.baseUrl}`);
  }
}

function printExtensionSummary(entry, t) {
  const badges = [
    `${t('common.file')}: ${entry.installPath || t('common.notSet')}`,
    `${t('extensions.type')}: ${entry.type}`,
    `${t('extensions.version')}: ${entry.version}`,
    `${t('extensions.status')}: ${formatExtensionStatusLabel(t, entry.enabled)}`,
  ];
  console.log(`${entry.enabled ? '•' : '◦'} ${entry.name} (${entry.id})`);
  console.log(`  ${t('extensions.author')}: ${entry.author || t('common.notSet')}`);
  console.log(`  ${t('extensions.capabilities')}: ${(entry.capabilities || []).join(', ') || t('common.notSet')}`);
  if (entry.installSourceType === 'registry') {
    badges.push(`${t('extensions.source')}: ${t('extensions.sourceRegistry')}`);
    badges.push(`${t('extensions.trust')}: ${entry.reviewStatus || entry.trustLevel || t('common.notSet')}`);
  } else {
    badges.push(`${t('extensions.source')}: ${t('extensions.sourceGitHub')}`);
  }
  console.log(`  ${badges.join(' | ')}`);
}

function printExtensionDetails(entry, manifest, source, t) {
  console.log(`${t('extensions.id')}: ${entry.id}`);
  console.log(`${t('extensions.name')}: ${entry.name}`);
  console.log(`${t('extensions.version')}: ${entry.version}`);
  console.log(`${t('extensions.type')}: ${entry.type}`);
  console.log(`${t('extensions.status')}: ${formatExtensionStatusLabel(t, entry.enabled)}`);
  console.log(`${t('extensions.author')}: ${entry.author || t('common.notSet')}`);
  console.log(`${t('extensions.description')}: ${entry.description || t('common.notSet')}`);
  console.log(`${t('extensions.source')}: ${source ? JSON.stringify(source, null, 2) : t('common.notSet')}`);
  console.log(`${t('extensions.installPath')}: ${entry.installPath}`);
  console.log(`${t('extensions.manifestPath')}: ${entry.manifestPath}`);
  console.log(`${t('extensions.entryPaths')}: ${(entry.entryPaths || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.capabilities')}: ${(entry.capabilities || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.trust')}: ${entry.reviewStatus || entry.trustLevel || t('common.notSet')}`);
  console.log(`${t('extensions.publisher')}: ${entry.publisher || t('common.notSet')}`);
  console.log(`${t('extensions.verifiedSource')}: ${entry.verifiedSource === true ? t('common.yes') : entry.verifiedSource === false ? t('common.no') : t('common.notSet')}`);
  console.log(`${t('extensions.supportedAppVersions')}: ${(entry.supportedAppVersions || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.installSourceType')}: ${entry.installSourceType || t('common.notSet')}`);
  console.log(`${t('extensions.lastCheckedAt')}: ${entry.lastCheckedAt || t('common.notSet')}`);
  if (manifest) {
    console.log('');
    console.log(JSON.stringify(manifest, null, 2));
  }
}

function printPluginSummary(plugin, t) {
  console.log(`${plugin.enabled ? '●' : '◦'} ${plugin.name} (${plugin.version})`);
  console.log(`  ${t('extensions.scope')}: ${plugin.scope}`);
  console.log(`  ${t('extensions.hooks')}: ${(plugin.hooks || []).join(', ') || t('common.notSet')}`);
  console.log(`  ${t('extensions.commands')}: ${(plugin.commands || []).join(', ') || t('common.notSet')}`);
  console.log(`  ${t('extensions.permissions')}: ${(plugin.permissions || []).join(', ') || t('common.notSet')}`);
  console.log(`  ${t('extensions.status')}: ${plugin.enabled ? t('extensions.statusEnabled') : t('extensions.statusDisabled')}`);
}

function printPluginDetails(plugin, t) {
  console.log(`${t('extensions.name')}: ${plugin.name}`);
  console.log(`${t('extensions.version')}: ${plugin.version}`);
  console.log(`${t('extensions.scope')}: ${plugin.scope}`);
  console.log(`${t('extensions.status')}: ${plugin.enabled ? t('extensions.statusEnabled') : t('extensions.statusDisabled')}`);
  console.log(`${t('extensions.description')}: ${plugin.description || t('common.notSet')}`);
  console.log(`${t('extensions.author')}: ${plugin.author || t('common.notSet')}`);
  console.log(`${t('extensions.hooks')}: ${(plugin.hooks || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.commands')}: ${(plugin.commands || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.permissions')}: ${(plugin.permissions || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('extensions.minWorkbenchVersion')}: ${plugin.minWorkbenchVersion || t('common.notSet')}`);
  console.log(`${t('extensions.directory')}: ${plugin.directory}`);
  console.log(`${t('extensions.manifestPath')}: ${plugin.manifestPath}`);
  console.log(`${t('extensions.loaded')}: ${plugin.loaded ? t('common.yes') : t('common.no')}`);
  if (plugin.stats) {
    console.log(`${t('extensions.stats')}: ${JSON.stringify(plugin.stats)}`);
  }
}

function printRegistrySummary(entry, t) {
  console.log(`${entry.recommended ? '★ ' : '• '} ${entry.name} (${entry.id})`);
  console.log(`  ${t('registry.type')}: ${entry.type}`);
  console.log(`  ${t('registry.version')}: ${entry.version}`);
  console.log(`  ${t('registry.publisher')}: ${entry.publisher || t('common.notSet')}`);
  console.log(`  ${t('registry.reviewStatus')}: ${entry.reviewStatus || t('common.notSet')}`);
  console.log(`  ${t('registry.verifiedSource')}: ${entry.verifiedSource === true ? t('common.yes') : entry.verifiedSource === false ? t('common.no') : t('common.notSet')}`);
  console.log(`  ${t('registry.supportedAppVersions')}: ${(entry.supportedAppVersions || []).join(', ') || t('common.notSet')}`);
  console.log(`  ${t('registry.capabilities')}: ${(entry.capabilities || []).join(', ') || t('common.notSet')}`);
  console.log(`  ${t('registry.source')}: ${entry.registrySourceLabel || entry.registrySourceLocation || t('common.notSet')}`);
}

function printRegistryDetails(entry, t) {
  console.log(`${t('registry.id')}: ${entry.id}`);
  console.log(`${t('registry.name')}: ${entry.name}`);
  console.log(`${t('registry.version')}: ${entry.version}`);
  console.log(`${t('registry.type')}: ${entry.type}`);
  console.log(`${t('registry.publisher')}: ${entry.publisher || t('common.notSet')}`);
  console.log(`${t('registry.reviewStatus')}: ${entry.reviewStatus || t('common.notSet')}`);
  console.log(`${t('registry.verifiedSource')}: ${entry.verifiedSource === true ? t('common.yes') : entry.verifiedSource === false ? t('common.no') : t('common.notSet')}`);
  console.log(`${t('registry.trustLevel')}: ${entry.trustLevel || t('common.notSet')}`);
  console.log(`${t('registry.recommended')}: ${entry.recommended ? t('common.yes') : t('common.no')}`);
  console.log(`${t('registry.source')}: ${entry.registrySourceLabel || entry.registrySourceLocation || t('common.notSet')}`);
  console.log(`${t('registry.sourceLocation')}: ${entry.registrySourceLocation || t('common.notSet')}`);
  console.log(`${t('registry.manifestPath')}: ${entry.manifestPath || t('common.notSet')}`);
  console.log(`${t('registry.supportedAppVersions')}: ${(entry.supportedAppVersions || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('registry.capabilities')}: ${(entry.capabilities || []).join(', ') || t('common.notSet')}`);
  console.log(`${t('registry.installNotes')}: ${entry.installNotes || t('common.notSet')}`);
  console.log(`${t('registry.lastCheckedAt')}: ${entry.lastCheckedAt || t('common.notSet')}`);
  if (entry.validationStatus || (entry.validationIssues || []).length) {
    console.log(`${t('registry.validationStatus')}: ${entry.validationStatus || t('common.notSet')}`);
    if ((entry.validationIssues || []).length) {
      console.log(`${t('registry.validationIssues')}:`);
      for (const issue of entry.validationIssues) {
        console.log(`- ${issue}`);
      }
    }
  }
}

async function tryLaunchEditor(filePath) {
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    const result = spawnSync(editor, [filePath], {
      stdio: 'inherit',
    });
    return result.status === 0;
  }

  if (process.platform === 'darwin') {
    const result = spawnSync('open', ['-t', filePath], {
      stdio: 'inherit',
    });
    return result.status === 0;
  }

  return false;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function promptConfirmation(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} `);
    return ['y', 'yes', 'да', 'д', 'ok', 'o'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function getTranslator() {
  const locale = normalizeLocaleCode(process.env.APP_LOCALE || 'ru');
  return {
    locale,
    t: await createTranslator(locale),
  };
}

async function refreshVectorIndex(projectRoot, policy) {
  const vectorIndex = policy?.vectorIndex || {};
  if (vectorIndex.enabled === false) {
    return null;
  }
  try {
    const embeddingProvider = await prepareEmbeddingProvider(projectRoot, policy);
    return await indexIncremental(projectRoot, policy, embeddingProvider);
  } catch {
    return null;
  }
}

async function handleProjectCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();

  if (subcommand === 'init') {
    const { memoryRoot } = await prepareProjectWorkspace(projectRoot);
    const policy = await readProjectPolicy(projectRoot);
    const runnerConfig = policy.testRunner || {};
    const hasRunnerConfig = Boolean(runnerConfig.command) || (Array.isArray(runnerConfig.runners) && runnerConfig.runners.length > 0);
    if (!hasRunnerConfig) {
      const detected = await detectRunner(projectRoot);
      await updatePolicyWithDetectedRunner(projectRoot, detected);
    }
    console.log(t('project.initialized', { path: memoryRoot }));
    return;
  }

  if (subcommand === 'status') {
    const status = await getProjectMemoryStatus(projectRoot);
    const state = await readProjectState(projectRoot);
    const policy = await readProjectPolicy(projectRoot);
    const patchStatus = await getPatchStatus(projectRoot);
    const extensions = await listInstalledExtensions(projectRoot);
    const registry = await getRegistryCatalog(projectRoot);
    const taskState = await getCurrentTask(projectRoot);
    console.log(`${t('project.statusTitle')}`);
    console.log(`${t('common.projectRoot')}: ${status.projectRoot}`);
    console.log(t('project.memoryExists', { value: status.exists ? t('project.memoryExistsYes') : t('project.memoryExistsNo') }));
    console.log(t('project.moduleSummaries', { count: status.summaryCount }));
    console.log(t('extensions.statusSummary', { total: extensions.length, enabled: extensions.filter((entry) => entry.enabled).length }));
    console.log(t('registry.statusSummary', {
      total: registry.entries.length,
      trusted: registry.entries.filter((entry) => entry.reviewStatus === 'reviewed' || entry.reviewStatus === 'trusted' || entry.verifiedSource === true).length,
    }));
    console.log(t('common.createdAt', { value: formatDate(status.createdAt, locale) }));
    console.log(t('common.updatedAt', { value: formatDate(status.updatedAt, locale) }));
    console.log(t('common.lastRefresh', { value: formatDate(status.lastRefreshAt, locale) }));
    console.log(t('common.selectedProvider', { provider: status.selectedProvider || t('common.notSet') }));
    console.log(t('common.activeRole', { role: status.activeRole || t('common.notSet') }));
    console.log(t('common.selectedModel', { model: status.selectedModel || t('common.notSet') }));
    console.log(t('project.freezeModeLabel', { value: state?.freezeMode?.enabled ? t('project.freezeModeEnabled') : t('project.freezeModeDisabled') }));
    console.log(t('policy.approvalModeLabel', { mode: t(`policy.approvalMode.${policy.approvalMode}`) }));
    console.log(t('policy.filePath', { path: getPolicyPath(projectRoot) }));
    console.log(t('common.currentTask', { id: taskState ? `${taskState.id} (${taskState.title})` : t('common.notSet') }));
    console.log(t('patch.currentPatch', { status: patchStatus.latest ? formatPatchStateLabel(t, patchStatus.latest.status) : t('patch.noPending') }));
    if (status.exists) {
      const summaries = await listMemoryModuleSummaries(projectRoot);
      if (summaries.length) {
        console.log(t('common.summaryNames', { names: summaries.join(', ') }));
      }
    }
    return;
  }

  if (subcommand === 'freeze' || subcommand === 'unfreeze') {
    const enabled = subcommand === 'freeze';
    const reason = String(options.reason || options._.join(' ') || '').trim();
    const result = await setProjectFreezeMode(projectRoot, enabled, { reason });
    console.log(t(enabled ? 'project.freezeEnabled' : 'project.freezeDisabled'));
    console.log(t('project.freezeModeLabel', { value: result.freezeMode.enabled ? t('project.freezeModeEnabled') : t('project.freezeModeDisabled') }));
    console.log(t('policy.filePath', { path: getPolicyPath(projectRoot) }));
    return;
  }

  if (subcommand === 'refresh') {
    const { state, moduleSummaries } = await refreshProjectMemory(projectRoot);
    console.log(t('project.refreshed', { root: state.projectRoot }));
    console.log(t('project.moduleSummaries', { count: moduleSummaries.length }));
    console.log(t('common.lastRefresh', { value: formatDate(state.lastRefreshAt, locale) }));
    const policy = await readProjectPolicy(projectRoot).catch(() => ({}));
    const vectorStats = await refreshVectorIndex(projectRoot, policy);
    if (vectorStats) {
      console.log(`Vector index updated: ${vectorStats.filesProcessed} files, ${vectorStats.chunksAdded} chunks`);
    }
    return;
  }

  if (subcommand === 'summary') {
    const summary = await summarizeCurrentMemory(projectRoot);
    console.log(`${t('project.summaryHeader')}\n${summary}`);
    return;
  }

  printUsage(t);
}

async function buildIndexTarget(projectRoot, policy, target, embeddingProvider, force = false) {
  if (force) {
    await dropIndex(projectRoot, target);
  }
  if (target === 'memory') {
    return indexMemory(projectRoot, policy, embeddingProvider, { force });
  }
  if (target === 'code') {
    return indexCode(projectRoot, policy, embeddingProvider, { force });
  }
  return indexAll(projectRoot, policy, embeddingProvider, { force });
}

async function handleIndexCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  const policy = await readProjectPolicy(projectRoot).catch(() => ({}));
  const target = normalizeIndexTarget(options.target || 'all');

  if (subcommand === 'status') {
    const status = await getIndexStatus(projectRoot, policy);
    console.log(formatIndexStatusOutput(status, t, locale));
    return;
  }

  if (subcommand === 'drop') {
    if (!options.yes && !options.confirm) {
      const approved = await promptConfirmation(`Удалить vector index (${target})? [y/N]`);
      if (!approved) {
        console.log('Удаление отменено.');
        return;
      }
    }
    await dropIndex(projectRoot, target);
    console.log(`Vector index удалён: ${target}`);
    return;
  }

  const embeddingProvider = await prepareEmbeddingProvider(projectRoot, policy);

  if (subcommand === 'build') {
    const stats = await buildIndexTarget(projectRoot, policy, target, embeddingProvider, options.force === true);
    console.log(`Индексирование завершено (${target}).`);
    console.log(`Файлов: ${stats.filesProcessed}`);
    console.log(`Чанков добавлено: ${stats.chunksAdded}`);
    console.log(`Чанков обновлено: ${stats.chunksUpdated}`);
    console.log(`Чанков удалено: ${stats.chunksDeleted}`);
    console.log(`Пропущено: ${stats.skipped}`);
    console.log(`Время: ${(stats.durationMs / 1000).toFixed(1)}s`);
    return;
  }

  if (subcommand === 'update') {
    const stats = await indexIncremental(projectRoot, policy, embeddingProvider);
    console.log('Инкрементальное обновление индекса завершено.');
    console.log(`Файлов: ${stats.filesProcessed}`);
    console.log(`Чанков добавлено: ${stats.chunksAdded}`);
    console.log(`Чанков обновлено: ${stats.chunksUpdated}`);
    console.log(`Чанков удалено: ${stats.chunksDeleted}`);
    console.log(`Пропущено: ${stats.skipped}`);
    console.log(`Время: ${(stats.durationMs / 1000).toFixed(1)}s`);
    return;
  }

  if (subcommand === 'rebuild') {
    const stats = await rebuildIndex(projectRoot, policy, embeddingProvider, target);
    console.log(`Индекс пересобран (${target}).`);
    console.log(`Файлов: ${stats.filesProcessed}`);
    console.log(`Чанков добавлено: ${stats.chunksAdded}`);
    console.log(`Чанков обновлено: ${stats.chunksUpdated}`);
    console.log(`Чанков удалено: ${stats.chunksDeleted}`);
    console.log(`Пропущено: ${stats.skipped}`);
    console.log(`Время: ${(stats.durationMs / 1000).toFixed(1)}s`);
    return;
  }

  printUsage(t);
}

async function handleSearchCommand(options, t, locale) {
  const projectRoot = process.cwd();
  const query = String(options._[0] || '').trim();
  if (!query) {
    throw new Error('Нужно указать поисковый запрос.');
  }
  const source = normalizeSearchSource(options.source || 'all');
  const sources = source === 'all' ? ['memory', 'code'] : [source];
  const results = await semanticSearch(projectRoot, query, {
    limit: Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 10,
    sources,
    minScore: Number.isFinite(options.minScore) ? options.minScore : 0.65,
  });
  console.log(`Поиск: "${query}"`);
  console.log(`Embedding: ${results.embeddingModel || '—'}  Время: ${(results.durationMs / 1000).toFixed(1)}s`);
  console.log(formatIndexSearchOutput(results, {
    verbose: options.verbose === true,
  }));
}

async function handleProviderCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureProvidersWorkspace(projectRoot);

  if (subcommand === 'list') {
    const catalog = await listProviderSummaries(projectRoot);
    console.log(t('provider.listTitle'));
    console.log(t('provider.defaultLabel', { provider: catalog.activeProvider || catalog.defaultProvider }));
    if (catalog.fallbackProvider) {
      console.log(t('provider.fallbackLabel', { provider: catalog.fallbackProvider }));
    }
    for (const entry of catalog.providers) {
      printProviderSummary(entry, t);
      console.log('');
    }
    return;
  }

  if (subcommand === 'use') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingProviderName'));
    }
    const provider = await useProvider(projectRoot, name, { model: options.model || null });
    console.log(t('provider.used', { provider: provider.name, model: options.model || provider.defaultModel }));
    return;
  }

  if (subcommand === 'set-key') {
    const name = options._[0];
    const key = options._[1];
    if (!name) {
      throw new Error(t('common.missingProviderName'));
    }
    if (!key) {
      throw new Error(t('common.missingProviderKey'));
    }
    const provider = await setProviderApiKey(projectRoot, name, key);
    console.log(t('provider.keySaved', { provider: name }));
    console.log(t('provider.providerEnabled', { provider: name, model: provider.defaultModel }));
    return;
  }

  if (subcommand === 'setup') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingProviderName'));
    }
    const key = options.token || await promptHookInput(`Введите API-ключ для ${name}:`);
    const model = options.model || await promptHookInput(`Введите модель [${t('common.notSet')}]:`);
    const provider = await setProviderApiKey(projectRoot, name, key);
    if (model) {
      await setProviderModel(projectRoot, name, model);
    }
    await useProvider(projectRoot, name, { model: model || provider.defaultModel });
    console.log(t('provider.keySaved', { provider: name }));
    console.log(t('provider.providerEnabled', { provider: name, model: model || provider.defaultModel }));
    return;
  }

  if (subcommand === 'health') {
    const catalog = await listProviderSummaries(projectRoot);
    console.log(t('provider.healthTitle'));
    const target = options._[0] || null;
    const providers = target ? catalog.providers.filter((provider) => provider.name === target) : catalog.providers.filter((provider) => provider.enabled);
    for (const entry of providers) {
      const label = entry.health.ok
        ? t('provider.healthOk')
        : t('provider.healthFailed', { reason: entry.health.error || entry.health.message || t('common.notSet') });
      console.log(`${entry.name}: ${label}`);
    }
    return;
  }

  if (subcommand === 'models') {
    const name = options._[0] || null;
    const provider = await getProvider(projectRoot, name);
    const models = await provider.listModels();
    if (!models.length) {
      console.log(t('provider.noModels', { provider: provider.name }));
      return;
    }
    console.log(t('provider.modelsTitle', { provider: provider.name }));
    for (const model of models) {
      const id = model?.id || model;
      const label = model?.name && model?.name !== id ? `${id} — ${model.name}` : id;
      console.log(label);
    }
    return;
  }

  if (subcommand === 'fallback') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingProviderName'));
    }
    await setProviderFallback(projectRoot, name);
    console.log(t('provider.fallbackSet', { provider: name }));
    return;
  }

  printUsage(t);
}

function formatHookSummary(hook) {
  const enabled = hook.enabled ? '✅' : '⏸';
  const events = (hook.on || []).join(', ') || '—';
  const conditions = hook.conditions ? ` [${hook.conditions}]` : '';
  return `${enabled}  ${String(hook.id || '').padEnd(22)} ${String(hook.channel || '—').padEnd(8)} ${events}${conditions}`;
}

async function promptHookInput(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Интерактивный ввод недоступен: ${question}`);
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} `);
    return String(answer || '').trim();
  } finally {
    rl.close();
  }
}

async function handleHooksCommand(subcommand, options, t) {
  const projectRoot = process.cwd();
  await ensureProjectPolicy(projectRoot);
  await initHooks(projectRoot);

  if (subcommand === 'list') {
    const hooks = await listHooks(projectRoot);
    console.log('Хуки');
    console.log('──────────────────────────────────────────────────────');
    for (const hook of hooks) {
      console.log(formatHookSummary(hook));
    }
    if (!hooks.length) {
      console.log('—');
    }
    return;
  }

  if (subcommand === 'test') {
    const hookId = options._[0];
    if (!hookId) {
      throw new Error('Не указан ID хука.');
    }
    console.log(`Отправляю тестовое событие в ${hookId}...`);
    const results = await testHook(projectRoot, hookId);
    if (!results.length) {
      console.log('⚠️ Хук не сработал.');
      return;
    }
    for (const result of results) {
      console.log(`${result.status === 'sent' ? '✅' : '❌'} ${result.channel} ${result.durationMs || 0}мс${result.error ? ` ${result.error}` : ''}`);
    }
    return;
  }

  if (subcommand === 'setup') {
    const channel = String(options._[0] || '').trim().toLowerCase();
    if (channel !== 'telegram') {
      throw new Error('Поддерживается только `app hooks setup telegram`.');
    }
    const botToken = options.token || await promptHookInput('Введите Bot Token:');
    const chatId = options.chatId || await promptHookInput('Введите Chat ID:');
    await setupTelegramHook(projectRoot, { botToken, chatId, enable: true });
    const hooks = await listHooks(projectRoot);
    const telegramHook = hooks.find((hook) => hook.channel === 'telegram');
    if (telegramHook) {
      console.log('Отправляю тестовое сообщение...');
      await testHook(projectRoot, telegramHook.id);
    }
    console.log('✅ Telegram настроен. Токен сохранён в ~/.workbench/secrets.json');
    console.log('policy.json обновлён.');
    return;
  }

  if (subcommand === 'enable' || subcommand === 'disable') {
    const hookId = options._[0];
    if (!hookId) {
      throw new Error('Не указан ID хука.');
    }
    await setHookEnabled(projectRoot, hookId, subcommand === 'enable');
    console.log(`Хук ${hookId} ${subcommand === 'enable' ? 'включён' : 'выключен'}.`);
    return;
  }

  if (subcommand === 'history') {
    const history = await getHooksHistory(projectRoot, { limit: options.limit || 10 });
    for (const entry of history) {
      const ts = formatDate(entry.ts);
      const icon = entry.status === 'sent' ? '✅' : '❌';
      console.log(`${ts}  ${entry.hookId}  ${entry.channel}  ${icon} ${entry.status} ${entry.durationMs ? `${entry.durationMs}мс` : ''}${entry.error ? ` ${entry.error}` : ''}`.trim());
    }
    if (!history.length) {
      console.log('История хука пуста.');
    }
    return;
  }

  if (subcommand === 'add') {
    const channel = String(options.channel || await promptHookInput('Канал? [telegram/shell/webhook]:')).trim().toLowerCase();
    const onText = String(options.on || await promptHookInput('События? (через запятую):')).trim();
    const message = String(options.message || await promptHookInput('Сообщение:')).trim();
    const hookId = String(options.id || await promptHookInput('ID хука:')).trim();
    const name = String(options.name || await promptHookInput('Название:')).trim() || hookId;
    const nextHook = {
      id: hookId,
      name,
      enabled: true,
      on: onText.split(',').map((value) => value.trim()).filter(Boolean),
      channel,
      message,
      command: options.command || '',
      args: Array.isArray(options.args) ? options.args : [],
      url: options.url || '',
      method: options.method || 'POST',
      headers: {},
      body: options.body || '',
      conditions: {},
    };
    await addHook(projectRoot, nextHook);
    console.log('Хук добавлен и включён.');
    return;
  }

  printUsage(t);
}

async function handleWorkspaceCommand(subcommand, options, t, locale) {
  await initGlobalWorkspace();

  if (subcommand === 'add') {
    const projectPath = options._[0] || process.cwd();
    const workspace = await addWorkspace(projectPath, {
      alias: options.alias || null,
      tags: options.tags || [],
      pin: options.pin === true,
    });
    console.log(`Добавлен workspace: ${workspace.alias} → ${workspace.path}`);
    return;
  }

  if (subcommand === 'list') {
    const workspaces = await listWorkspaces({
      pinned: options.pinned === true,
      tag: options.tags?.[0] || null,
      sort: options.sort || null,
    });
    console.log(`Воркспейсы (${workspaces.length})`);
    if (!workspaces.length) {
      console.log('Реестр пуст.');
      return;
    }
    for (const workspace of workspaces) {
      printWorkspaceCompact(workspace, locale);
    }
    return;
  }

  if (subcommand === 'switch') {
    const workspaces = await listWorkspaces({ sort: options.sort || null });
    if (!workspaces.length) {
      console.log('Реестр воркспейсов пуст. Запускаю текущую папку.');
      await runProjectStart(process.cwd(), options, t, locale);
      return;
    }
    let target = options._[0] || null;
    if (!target) {
      const selected = await promptWorkspaceSelection(workspaces, t, locale);
      if (!selected) {
        console.log('Выбор отменён.');
        return;
      }
      target = selected.alias;
    }
    const workspace = await switchWorkspace(target);
    console.log(`Переключение на: ${workspace.alias} (${workspace.path})`);
    console.log(`Провайдер: ${workspace.snapshot.provider || '—'}/${workspace.snapshot.model || '—'}`);
    console.log(`Роль: ${workspace.snapshot.role || '—'}`);
    console.log(`Активная задача: ${workspace.snapshot.activeTask || '—'}`);
    console.log('Запуск агента...');
    await runProjectStart(workspace.path, {
      ...options,
      provider: options.provider || workspace.snapshot.provider || null,
      model: options.model || workspace.snapshot.model || null,
    }, t, locale);
    return;
  }

  if (subcommand === 'status') {
    const target = options._[0] || null;
    if (target) {
      const workspaces = await listWorkspaces({ sort: options.sort || null });
      const workspace = workspaces.find((item) => item.alias === target || item.id === target) || null;
      if (!workspace) {
        console.log(`Воркспейс не найден: ${target}`);
        return;
      }
      console.log(`Воркспейс: ${workspace.alias}`);
      console.log(`Имя: ${workspace.name}`);
      console.log(`Путь: ${workspace.path}`);
      console.log(`Доступен: ${workspace.available === false ? 'нет' : 'да'}`);
      console.log(`Провайдер: ${workspace.snapshot.provider || '—'}`);
      console.log(`Модель: ${workspace.snapshot.model || '—'}`);
      console.log(`Роль: ${workspace.snapshot.role || '—'}`);
      console.log(`Активная задача: ${workspace.snapshot.activeTask || '—'}`);
      console.log(`Задач всего: ${workspace.snapshot.taskCount || 0}`);
      console.log(`Последнее открытие: ${formatRelativeTime(workspace.lastOpenedAt, locale)}`);
      return;
    }
    const workspaces = await listWorkspaces({ sort: options.sort || null });
    console.log(`Статус всех проектов (${workspaces.length})`);
    for (const workspace of workspaces) {
      printWorkspaceCompact(workspace, locale);
    }
    return;
  }

  if (subcommand === 'remove') {
    const target = options._[0];
    if (!target) {
      throw new Error('Нужно указать alias или id воркспейса.');
    }
    if (!options.confirm) {
      const approved = await promptConfirmation(`Удалить ${target} из реестра? [y/N]`);
      if (!approved) {
        console.log('Удаление отменено.');
        return;
      }
    }
    const removed = await removeWorkspace(target);
    console.log(`Удалён из реестра: ${removed.alias}`);
    return;
  }

  if (subcommand === 'rename') {
    const target = options._[0];
    const nextAlias = options._[1];
    if (!target || !nextAlias) {
      throw new Error('Нужно указать alias и новый alias.');
    }
    const workspace = await renameWorkspace(target, nextAlias);
    console.log(`Переименован: ${target} → ${workspace.alias}`);
    return;
  }

  if (subcommand === 'pin' || subcommand === 'unpin') {
    const target = options._[0];
    if (!target) {
      throw new Error('Нужно указать alias или id воркспейса.');
    }
    const workspace = await pinWorkspace(target, subcommand === 'pin');
    console.log(`${subcommand === 'pin' ? '📌' : '◦'} ${workspace.alias} ${subcommand === 'pin' ? 'закреплён' : 'откреплён'}`);
    return;
  }

  if (subcommand === 'tag' || subcommand === 'untag') {
    const target = options._[0];
    const tag = options._[1];
    if (!target || !tag) {
      throw new Error('Нужно указать alias и тег.');
    }
    const workspace = await tagWorkspace(target, tag, subcommand === 'untag');
    console.log(`${workspace.alias}: ${subcommand === 'tag' ? 'добавлен' : 'удалён'} тег ${tag}`);
    return;
  }

  if (subcommand === 'search') {
    const query = options._[0];
    if (!query) {
      throw new Error('Нужно указать поисковый запрос.');
    }
    const results = await searchWorkspaces(query);
    console.log(`Поиск: ${query}`);
    if (!results.length) {
      console.log('Совпадений не найдено.');
      return;
    }
    for (const workspace of results) {
      printWorkspaceCompact(workspace, locale);
    }
    return;
  }

  if (subcommand === 'refresh') {
    const target = options._[0] || null;
    if (target) {
      const workspace = await refreshWorkspaceSnapshot(target);
      console.log(`Snapshot обновлён: ${workspace.alias}`);
      return;
    }
    const workspaces = await listWorkspaces();
    for (const workspace of workspaces) {
      await refreshWorkspaceSnapshot(workspace.alias);
    }
    console.log(`Обновлены snapshots для всех воркспейсов (${workspaces.length})`);
    return;
  }

  if (subcommand === 'config') {
    if (options.set) {
      const patch = parseWorkspaceConfigPatch(options.set);
      if (!patch) {
        throw new Error('Формат --set должен быть key=value.');
      }
      const next = await writeGlobalConfig(patch);
      console.log(`Глобальный конфиг обновлён: ${getWorkspaceConfigPath()}`);
      console.log(`defaultProvider: ${next.defaultProvider}`);
      console.log(`defaultModel: ${next.defaultModel}`);
      console.log(`autoRefreshOnSwitch: ${next.autoRefreshOnSwitch ? 'true' : 'false'}`);
      return;
    }
    const config = await readGlobalConfig();
    console.log(`Глобальный конфиг: ${getWorkspaceConfigPath()}`);
    console.log(`defaultProvider: ${config.defaultProvider}`);
    console.log(`defaultModel: ${config.defaultModel}`);
    console.log(`autoRefreshOnSwitch: ${config.autoRefreshOnSwitch ? 'true' : 'false'}`);
    console.log(`listSort: ${config.listSort}`);
    console.log(`dateLocale: ${config.dateLocale}`);
    return;
  }

  if (subcommand === 'repair') {
    const workspaces = await repairWorkspaces();
    console.log(`Реестр восстановлен. Найдено проектов: ${workspaces.length}`);
    return;
  }

  printUsage(t);
}

function formatServerConfigOutput(config, t) {
  const lines = [
    `${t('server.configTitle')}`,
    `${t('server.port')}: ${config.port}`,
    `${t('server.host')}: ${config.host}`,
    `${t('server.openOnStart')}: ${config.openOnStart ? t('common.yes') : t('common.no')}`,
    `${t('server.authEnabled')}: ${config.auth?.enabled ? t('common.yes') : t('common.no')}`,
    `${t('server.authUsername')}: ${config.auth?.username || t('common.notSet')}`,
    `${t('server.corsOrigins')}: ${(config.corsOrigins || []).join(', ') || t('common.notSet')}`,
  ];
  return lines.join('\n');
}

function formatIndexStatusOutput(status, t, locale) {
  const lines = [
    'Vector Index Status',
    '────────────────────────────────────────────────────────────',
  ];
  for (const table of status.tables || []) {
    lines.push(`${table.tableName.padEnd(8)} ${String(table.totalChunks || 0).padStart(6)} чанков   ${table.embeddingModel || '—'}   ${table.updatedAt ? formatDate(table.updatedAt, locale) : '—'}`);
  }
  lines.push('────────────────────────────────────────────────────────────');
  lines.push(`Embedding: ${status.embedding?.provider || '—'} / ${status.embedding?.model || '—'} (${status.embedding?.dimensions || '—'} dim)`);
  lines.push(`Размер на диске: ${formatBytes(status.sizeBytes || 0)}`);
  return lines.join('\n');
}

function formatIndexSearchOutput(results, opts = {}) {
  return formatResults(results, {
    verbose: opts.verbose === true,
    showContent: true,
    maxContentLength: opts.maxContentLength || 240,
  });
}

async function handleServerCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureProjectPolicy(projectRoot);

  if (subcommand === 'start') {
    const result = await startServer(projectRoot, {
      port: options.port,
      host: options.host,
      open: options.open,
    });
    console.log(t('server.started', { url: result.url }));
    console.log(`${t('server.host')}: ${result.config.host}`);
    console.log(`${t('server.port')}: ${result.config.port}`);
    if (result.opened) {
      console.log(t('server.browserOpening'));
    }
    return;
  }

  if (subcommand === 'stop') {
    const result = await stopServer(projectRoot);
    if (result.stopped) {
      console.log(t('server.stopped'));
      return;
    }
    console.log(t('server.notRunning'));
    return;
  }

  if (subcommand === 'status') {
    const status = await getServerStatus(projectRoot);
    if (!status.running) {
      console.log(t('server.notRunning'));
      return;
    }
    console.log(t('server.statusTitle'));
    console.log(`${t('server.pid')}: ${status.pid}`);
    console.log(`${t('server.url')}: ${status.url}`);
    return;
  }

  if (subcommand === 'config') {
    const config = await getServerConfig(projectRoot);
    console.log(formatServerConfigOutput(config, t));
    return;
  }

  printUsage(t);
}

function formatStatsCsv(stats) {
  const rows = [['section', 'metric', 'value']];
  const push = (section, metric, value) => {
    rows.push([section, metric, String(value ?? '')]);
  };

  push('meta', 'generatedAt', stats.generatedAt || '');
  push('meta', 'periodFrom', stats.period?.from || '');
  push('meta', 'periodTo', stats.period?.to || '');
  push('tasks', 'total', stats.tasks?.total || 0);
  push('tasks', 'active', stats.tasks?.byStatus?.active || 0);
  push('tasks', 'done', stats.tasks?.byStatus?.done || 0);
  push('tasks', 'archived', stats.tasks?.byStatus?.archived || 0);
  push('patches', 'total', stats.patches?.total || 0);
  push('patches', 'applied', stats.patches?.applied || 0);
  push('patches', 'rejected', stats.patches?.rejected || 0);
  push('patches', 'rolledBack', stats.patches?.rolledBack || 0);
  push('tests', 'total', stats.tests?.total || 0);
  push('tests', 'passed', stats.tests?.passed || 0);
  push('tests', 'failed', stats.tests?.failed || 0);
  push('tests', 'errored', stats.tests?.errored || 0);
  push('tests', 'timeout', stats.tests?.timeout || 0);
  push('autoRuns', 'total', stats.autoRuns?.total || 0);
  push('autoRuns', 'completed', stats.autoRuns?.completed || 0);
  push('autoRuns', 'aborted', stats.autoRuns?.aborted || 0);
  push('providers', 'topProvider', stats.providers?.topProvider || '');
  push('roles', 'topRole', stats.roles?.topRole || '');
  push('tokens', 'prompt', stats.tokens?.totalPrompt || 0);
  push('tokens', 'completion', stats.tokens?.totalCompletion || 0);
  for (const file of Array.isArray(stats.tasks?.topFiles) ? stats.tasks.topFiles : []) {
    push('topFiles', file.path || '', file.taskCount || 0);
  }

  return rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }).join(',')).join('\n');
}

async function resolveStatsExportPath(basePath, format) {
  const extension = format === 'csv' ? '.csv' : '.json';
  const defaultName = `workbench-stats${extension}`;
  if (!basePath) {
    return path.join(process.cwd(), defaultName);
  }
  const resolved = path.resolve(basePath);
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      return path.join(resolved, defaultName);
    }
  } catch {
    // ignore
  }
  if (resolved.endsWith(path.sep)) {
    return path.join(resolved, defaultName);
  }
  return resolved;
}

async function resolveBudgetExportPath(basePath, format) {
  const extension = format === 'csv' ? '.csv' : '.json';
  const defaultName = `workbench-budget${extension}`;
  if (!basePath) {
    return path.join(process.cwd(), defaultName);
  }
  const resolved = path.resolve(basePath);
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      return path.join(resolved, defaultName);
    }
  } catch {
    // ignore
  }
  if (resolved.endsWith(path.sep)) {
    return path.join(resolved, defaultName);
  }
  return resolved;
}

function parseBudgetLimitValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || String(value).trim().toLowerCase() === 'null') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Неверный лимит токенов: ${value}`);
  }
  return Math.floor(parsed);
}

async function handleStatsCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();

  if (subcommand === 'refresh') {
    const stats = await refreshStats(projectRoot, {
      from: options.from || null,
      to: options.to || null,
    });
    console.log('Статистика обновлена.');
    console.log(`Сгенерировано: ${formatDate(stats.generatedAt, locale)}`);
    return;
  }

  if (subcommand === 'prune') {
    const keepDays = Number.isFinite(options.keepDays) ? options.keepDays : 90;
    const result = await pruneEvents(projectRoot, keepDays);
    console.log(`Удалено событий: ${result.removed}`);
    console.log(`Осталось: ${result.kept}`);
    return;
  }

  if (subcommand === 'export') {
    const stats = await getStats(projectRoot);
    const format = String(options.format || 'json').trim().toLowerCase() === 'csv' ? 'csv' : 'json';
    const outputPath = await resolveStatsExportPath(options.output || null, format);
    const content = format === 'csv'
      ? `${formatStatsCsv(stats)}\n`
      : `${JSON.stringify(stats, null, 2)}\n`;
    await writeFile(outputPath, content, 'utf8');
    console.log(`Статистика экспортирована: ${outputPath}`);
    return;
  }

  const stats = await getStats(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(formatStatsReport(stats, { section: options.section || 'all' }));
}

async function handleBudgetCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  const policy = await readProjectPolicy(projectRoot);
  const budget = policy.budget || {};

  if (subcommand === 'refresh') {
    const cache = await refreshBudgetCache(projectRoot);
    console.log('Бюджет обновлён.');
    console.log(`Сгенерировано: ${formatDate(cache.generatedAt, locale)}`);
    return;
  }

  if (subcommand === 'reset') {
    const cache = await refreshBudgetCache(projectRoot, {
      provider: options.provider || null,
      days: options.days || null,
      from: options.from || null,
      to: options.to || null,
    });
    console.log('Кэш бюджета сброшен.');
    console.log(`Сгенерировано: ${formatDate(cache.generatedAt, locale)}`);
    return;
  }

  if (subcommand === 'prune') {
    const keepDays = Number.isFinite(options.keepDays) ? options.keepDays : 90;
    const result = await pruneBudgetUsage(projectRoot, keepDays);
    console.log(`Удалено записей: ${result.removed}`);
    console.log(`Осталось: ${result.kept}`);
    return;
  }

  if (subcommand === 'export') {
    const format = String(options.format || 'csv').trim().toLowerCase() === 'json' ? 'json' : 'csv';
    const outputPath = await resolveBudgetExportPath(options.output || null, format);
    const content = format === 'csv'
      ? `${await exportBudgetCSV(projectRoot, {
        provider: options.provider || null,
        days: options.days || null,
        from: options.from || null,
        to: options.to || null,
      })}\n`
      : `${JSON.stringify(await getBudgetCache(projectRoot), null, 2)}\n`;
    await writeFile(outputPath, content, 'utf8');
    console.log(`Бюджет экспортирован: ${outputPath}`);
    return;
  }

  if (subcommand === 'set') {
    const provider = String(options._[0] || options.provider || '').trim().toLowerCase();
    if (!provider) {
      throw new Error('Укажите провайдера: app budget set <provider> --daily <n> --weekly <n> --monthly <n>');
    }
    const next = {
      ...policy,
      budget: {
        ...(budget || {}),
        limits: {
          ...(budget.limits || {}),
          [provider]: {
            ...(budget.limits?.[provider] || {}),
          },
        },
      },
    };
    if (options.daily !== undefined) {
      next.budget.limits[provider].daily = parseBudgetLimitValue(options.daily);
    }
    if (options.weekly !== undefined) {
      next.budget.limits[provider].weekly = parseBudgetLimitValue(options.weekly);
    }
    if (options.monthly !== undefined) {
      next.budget.limits[provider].monthly = parseBudgetLimitValue(options.monthly);
    }
    await writeProjectPolicy(projectRoot, next);
    console.log(`Лимиты ${provider} обновлены:`);
    console.log(`  daily:   ${formatBudgetTokens(next.budget.limits[provider].daily)}`);
    console.log(`  weekly:  ${formatBudgetTokens(next.budget.limits[provider].weekly)}`);
    console.log(`  monthly: ${formatBudgetTokens(next.budget.limits[provider].monthly)}`);
    return;
  }

  const cache = await getBudgetCache(projectRoot);
  if (options.json) {
    console.log(JSON.stringify({
      cache,
      limits: budget.limits || null,
      pricing: budget.pricing || null,
      enabled: budget.enabled !== false,
      onExceed: budget.onExceed || 'warn',
    }, null, 2));
    return;
  }

  if (subcommand === 'history') {
    const days = Number.isFinite(options.days) && options.days > 0 ? Math.floor(options.days) : 7;
    const provider = options.provider || null;
    const daily = Array.isArray(cache.daily) ? cache.daily.slice(-days) : [];
    console.log('Token Budget — history');
    console.log('─────────────────────────────────────────────────────────────────');
    for (const entry of daily) {
      if (provider) {
        const providerValue = Number(entry?.[provider]) || 0;
        console.log(`${entry.date}   ${formatBudgetTokens(providerValue)}   (${provider}: ${formatBudgetTokens(providerValue)})`);
        continue;
      }
      const parts = Object.keys(cache.byProvider || {}).map((name) => `${name}: ${formatBudgetTokens(entry?.[name] || 0)}`);
      console.log(`${entry.date}   ${formatBudgetTokens(entry.total)}   (${parts.join('  ')})`);
    }
    return;
  }

  const provider = options.provider || null;
  const entries = provider
    ? await listBudgetUsageEntries(projectRoot, {
      provider,
      days: options.days || null,
      from: options.from || null,
      to: options.to || null,
    })
    : [];
  console.log(formatBudgetReport(cache, budget.limits || {}, {
    provider,
    period: options.period || 'all',
    entries,
    showCost: options.showCost === true,
  }));
}

async function handleTestCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  const policy = await readProjectPolicy(projectRoot);
  await ensureProvidersWorkspace(projectRoot);

  if (subcommand === 'run') {
    const detected = await detectRunner(projectRoot);
    const command = options.command || policy.testRunner?.command || detected.command;
    const result = await runTests({
      projectRoot,
      policy,
      command,
      cwd: options.cwd || policy.testRunner?.cwd || null,
      timeout: options.timeout || policy.testRunner?.timeout || 120000,
      env: policy.testRunner?.env || {},
      allowApprovalBypass: true,
    });
    console.log(`${t('test.runTitle')}: ${result.command}`);
    console.log(`${t('test.statusLabel')}: ${t(`test.status.${result.status}`)}`);
    console.log(`${t('test.summary')}: ${result.summary ? `${result.summary.passed || 0}/${result.summary.total || 0}` : '—'}`);
    console.log(`${t('test.duration')}: ${Number.isFinite(result.duration) ? `${(result.duration / 1000).toFixed(1)}s` : '—'}`);
    if (result.failedTests.length) {
      console.log('');
      console.log(t('test.failedTests'));
      for (const item of result.failedTests) {
        console.log(`- ${item.name}${item.error ? `: ${item.error}` : ''}`);
      }
    }
    if (result.output) {
      console.log('');
      console.log(result.output);
    }
    return;
  }

  if (subcommand === 'history') {
    const history = await getTestRunHistory(projectRoot, {
      limit: options.limit || 20,
      status: options.status || null,
    });
    console.log(t('test.historyTitle'));
    if (!history.length) {
      console.log(t('test.historyEmpty'));
      return;
    }
    for (const run of history) {
      console.log(formatTestSummary(run, t, locale));
    }
    return;
  }

  if (subcommand === 'show') {
    const runId = options._[0];
    if (!runId) {
      throw new Error(t('common.missingRunId'));
    }
    const history = await getTestRunHistory(projectRoot, {});
    const run = history.find((entry) => entry.runId === runId);
    if (!run) {
      console.log(t('test.runNotFound', { id: runId }));
      return;
    }
    const log = await readTestRunLog(projectRoot, runId).catch(() => '');
    console.log(formatTestRunDetails({ ...run, output: log }, t, locale));
    return;
  }

  if (subcommand === 'detect') {
    const detected = await detectRunner(projectRoot);
    console.log(t('test.detectTitle'));
    console.log(`${t('test.detectRunner')}: ${detected.name}`);
    console.log(`${t('test.command')}: ${detected.command}`);
    console.log(`${t('test.cwd')}: ${detected.cwd || t('common.notSet')}`);
    console.log(`${t('test.source')}: ${detected.source || t('common.notSet')}`);
    const approve = options.yes || await promptConfirmation(t('test.detectSavePrompt'));
    if (approve) {
      await updatePolicyWithDetectedRunner(projectRoot, detected);
      console.log(t('test.detectSaved'));
    }
    return;
  }

  if (subcommand === 'config') {
    const config = await getTestRunnerConfig(projectRoot);
    console.log(formatTestRunnerConfig(config, t));
    return;
  }

  printUsage(t);
}

async function handleRolesCommand(subcommand, options, t) {
  const projectRoot = process.cwd();
  await scaffoldBuiltInRoles(projectRoot);

  if (subcommand === 'scaffold') {
    console.log(t('roles.scaffolded', { path: getRoleFileLocation(projectRoot, 'senior-engineer').replace(/\/senior-engineer\.md$/, '') }));
    return;
  }

  if (subcommand === 'list') {
    const profiles = await listRoleProfiles(projectRoot);
    const state = await readProjectState(projectRoot);
    const activeRole = state?.activeRole ? getResolvedRoleName(state.activeRole) : null;
    console.log(t('roles.listTitle'));
    for (const profile of profiles) {
      printRoleSummary(profile, t, { active: activeRole === profile.name });
    }
    return;
  }

  if (subcommand === 'show') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingRoleName'));
    }
    const profile = await loadRoleProfile(projectRoot, name);
    console.log(`Роль: ${profile.name}`);
    console.log(`Файл: ${profile.filePath}`);
    if (profile.fallback) {
      const details = profile.parseError ? ` (${profile.parseError})` : '';
      console.log(t('roles.fallbackNotice', { details }));
    }
    console.log('');
    console.log(formatRoleProfile(profile));
    return;
  }

  if (subcommand === 'use') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingRoleName'));
    }
    const profile = await setActiveRole(projectRoot, name);
    console.log(t('roles.roleSet', { role: profile.name }));
    console.log(t('roles.currentRolePath', { path: profile.filePath }));
    return;
  }

  if (subcommand === 'current') {
    const state = await readProjectState(projectRoot);
    if (!state?.activeRole) {
      console.log(t('common.currentRoleNotSet'));
      return;
    }
    const profile = await loadRoleProfile(projectRoot, state.activeRole);
    console.log(t('roles.currentRole', { role: profile.name }));
    console.log(t('roles.currentRolePath', { path: profile.filePath }));
    return;
  }

  if (subcommand === 'create') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingRoleName'));
    }
    const profile = await createRoleProfile(projectRoot, name);
    console.log(t('roles.roleProfileCreated', { path: profile.filePath }));
    return;
  }

  if (subcommand === 'edit') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingRoleName'));
    }
    const canonical = getResolvedRoleName(name);
    let filePath = getRoleFileLocation(projectRoot, canonical);
    if (!(await fileExists(filePath))) {
      const builtinNames = new Set(getBuiltinRoleNamesList());
      if (builtinNames.has(canonical)) {
        await scaffoldBuiltInRoles(projectRoot);
      } else {
        const created = await createRoleProfile(projectRoot, canonical);
        filePath = created.filePath;
      }
    }
    const launched = await tryLaunchEditor(filePath);
    if (launched) {
      console.log(t('roles.openedRole', { path: filePath }));
    } else {
      console.log(t('roles.editInstructions', { path: filePath }));
    }
    return;
  }

  printUsage(t);
}

async function handleMemoryCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();

  if (subcommand === 'show') {
    const name = options._[0];
    if (!name) {
      throw new Error(t('common.missingMemoryName'));
    }
    const content = await showMemoryEntry(projectRoot, name);
    process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
    return;
  }

  if (subcommand === 'rebuild') {
    const { state, moduleSummaries } = await rebuildProjectMemory(projectRoot);
    console.log(t('project.rebuilt', { root: state.projectRoot }));
    console.log(`${t('project.moduleSummaries', { count: moduleSummaries.length })}`);
    console.log(t('common.lastRefresh', { value: formatDate(state.lastRefreshAt, locale) }));
    return;
  }

  printUsage(t);
}

async function handlePromptCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await scaffoldBuiltInRoles(projectRoot);
  const roleProfile = await resolveRoleSelection(projectRoot, options.role || null);
  const memorySummary = await summarizeCurrentMemory(projectRoot);
  const currentTask = await getCurrentTask(projectRoot);
  const state = await readProjectState(projectRoot);
  const policy = await readProjectPolicy(projectRoot);
  const provider = await getProvider(projectRoot, state?.selectedProvider || null);
  const model = state?.selectedModel || provider.defaultModel;
  const taskConversation = currentTask
    ? await loadConversationBundle(projectRoot, currentTask, { provider, model, locale })
    : {
      summary: '',
      recentMessages: [],
      totalMessages: 0,
      sessionCount: 0,
      summaryGenerated: false,
      contextWindow: null,
    };
  const taskContext = await getCurrentTaskContext(projectRoot, locale);
  const extensionPrompts = await listEnabledExtensionPromptPacks(projectRoot);
  const taskInstruction = options.task || '';
  const allowedShellCommands = await listAllowedShellCommands(projectRoot);
  const composition = await composePromptLayers({
    baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
    roleProfile,
    memorySummary,
    taskContext,
    conversationSummary: taskConversation.summary,
    extensionPrompts,
    taskInstruction,
    allowedShellCommands,
    projectRoot,
    policy,
  });

  if (subcommand === 'inspect') {
    console.log(formatPromptInspection(composition));
    return;
  }

  printUsage(t);
}

async function handleTaskCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureTaskWorkspace(projectRoot);

  if (subcommand === 'create') {
    const title = options.title || options._[0];
    const request = options.request || options._.slice(1).join(' ');
    const task = await createTask(projectRoot, {
      title,
      userRequest: request || title,
      summary: options.summary || request || title,
      role: options.role || null,
      model: options.model || null,
      relevantFiles: options.files || [],
    }, locale);
    console.log(t('task.created', { id: task.id }));
    console.log(`${t('common.file')}: ${task.folderPath}`);
    return;
  }

  if (subcommand === 'list') {
    const listing = await listTasks(projectRoot, locale);
    console.log(t('task.listTitle'));
    printTaskList(listing.tasks, listing.formatTaskSummary, listing.emptyMessage);
    return;
  }

  if (subcommand === 'show') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const info = await showTask(projectRoot, id, locale);
    console.log(info.details);
    console.log('');
    console.log(`${t('common.file')}: ${info.folderPath}`);
    console.log(`task.md: ${info.folderPath}/task.md`);
    console.log(`plan.md: ${info.folderPath}/plan.md`);
    console.log(`notes.md: ${info.folderPath}/notes.md`);
    console.log(`artifacts.md: ${info.folderPath}/artifacts.md`);
    return;
  }

  if (subcommand === 'current') {
    const task = await getCurrentTask(projectRoot);
    if (!task) {
      console.log(t('task.currentNotSet'));
      return;
    }
    const info = await showTask(projectRoot, task.id, locale);
    console.log(t('task.currentSet', { id: task.id }));
    console.log(info.details);
    console.log('');
    console.log(`${t('common.file')}: ${info.folderPath}`);
    return;
  }

  if (subcommand === 'use') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await setCurrentTask(projectRoot, id, locale);
    console.log(t('task.used', { id: task.id }));
    return;
  }

  if (subcommand === 'plan') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const state = await readProjectState(projectRoot);
    const provider = await getProvider(projectRoot, state?.selectedProvider || null);
    const model = state?.selectedModel || provider.defaultModel;
    const currentContext = await getCurrentTaskContext(projectRoot, locale);
    const currentTask = await getCurrentTask(projectRoot);
    const taskConversation = currentTask
      ? await loadConversationBundle(projectRoot, currentTask, { provider, model, locale })
      : {
        summary: '',
      };
    const memorySummary = await summarizeCurrentMemory(projectRoot);
    const context = [memorySummary, currentContext, taskConversation.summary].filter(Boolean).join('\n\n');
    const result = await generateTaskPlan(projectRoot, id, { locale, context });
    console.log(t('task.planGenerated', { id: result.task.id }));
    console.log(`${t('common.file')}: ${result.planPath}`);
    return;
  }

  if (subcommand === 'note') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const text = options.text || options._.slice(1).join(' ');
    const result = await appendTaskNote(projectRoot, id, {
      kind: options.kind || 'note',
      text,
      source: 'cli',
    }, { locale });
    console.log(t('task.noteAppended', { id: result.task.id }));
    return;
  }

  if (subcommand === 'done') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await markTaskDone(projectRoot, id, { locale });
    console.log(t('task.done', { id: task.id }));
    return;
  }

  if (subcommand === 'archive') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await archiveTask(projectRoot, id, { locale });
    console.log(t('task.archived', { id: task.id }));
    return;
  }

  if (subcommand === 'history') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const taskDir = getTaskFolderPath(projectRoot, task);
    if (options.clear) {
      const stats = await listConversationStats(taskDir);
      if (!options.yes) {
        const approved = await promptConfirmation(t('task.historyClearPrompt', {
          count: stats.messageCount,
          id: task.id,
        }));
        if (!approved) {
          console.log(t('task.historyClearRejected'));
          return;
        }
      }
      await clearConversationHistory(taskDir);
      await setTaskLastSessionId(projectRoot, task.id, null, locale);
      console.log(t('task.historyCleared', { id: task.id }));
      return;
    }

    const sessionId = options.session || null;
    const limit = Number.isFinite(options.limit) ? options.limit : 20;
    const history = sessionId
      ? await readConversationSession(taskDir, sessionId)
      : await readRecentConversationMessages(taskDir, limit);
    const stats = await listConversationStats(taskDir);

    console.log(t('task.historyTitle', { id: task.id }));
    if (!history.length) {
      console.log(t('task.historyEmpty', { id: task.id }));
      return;
    }
    for (const message of history) {
      console.log(formatConversationMessage(message, locale));
    }
    console.log('');
    const providerNames = stats.providers.length ? stats.providers.join(', ') : t('common.notSet');
    console.log(t('task.historyFooter', {
      sessions: stats.sessionCount,
      messages: stats.messageCount,
      providers: providerNames,
    }));
    return;
  }

  if (subcommand === 'sessions') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const taskDir = getTaskFolderPath(projectRoot, task);
    const sessions = await listConversationSessions(taskDir);
    console.log(t('task.sessionsTitle', { id: task.id }));
    if (!sessions.length) {
      console.log(t('task.sessionsEmpty'));
      return;
    }
    for (const session of sessions) {
      console.log(formatSessionSummary(session, locale));
    }
    return;
  }

  if (subcommand === 'export') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const taskDir = getTaskFolderPath(projectRoot, task);
    const format = String(options.format || 'md').trim().toLowerCase() === 'json' ? 'json' : 'md';
    const outputPath = await resolveConversationExportPath(projectRoot, task, format, options.output || null);
    const result = format === 'json'
      ? await exportConversationToJson(taskDir, outputPath)
      : await exportConversationToMarkdown(taskDir, outputPath);
    console.log(t('task.exported', { path: result.path }));
    return;
  }

  if (subcommand === 'continue') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await setCurrentTask(projectRoot, id, locale);
    const project = await openProject(projectRoot);
    const state = await readProjectState(project.root);
    const sessionId = createSessionId();
    const provider = await getProvider(project.root, options.provider || null);
    const model = options.model || task.model || provider.defaultModel;
    const conversation = await loadConversationBundle(project.root, task, {
      provider,
      model,
      locale,
    });
    await setTaskLastSessionId(project.root, task.id, sessionId, locale);
    console.log(t('task.continueLoaded', {
      messages: conversation.totalMessages,
      sessions: conversation.sessionCount,
      limit: conversation.contextWindow?.historyMessages || 20,
    }));
    if (conversation.summaryGenerated) {
      console.log(t('task.conversationSummaryGenerated'));
    }
    console.log(t('task.continueReady'));
    await runInteractiveAgent({
      root: project.root,
      model,
      provider,
      initialConversationHistory: conversation.recentMessages,
      composePromptForTask: async (taskInstruction) => composePromptLayers({
        baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
        roleProfile: await resolveRoleSelection(project.root, task.role || state?.activeRole || null),
        memorySummary: await summarizeCurrentMemory(project.root),
        taskContext: await getCurrentTaskContext(project.root, locale),
        conversationSummary: conversation.summary,
        extensionPrompts: await listEnabledExtensionPromptPacks(project.root),
        taskInstruction,
        allowedShellCommands: await listAllowedShellCommands(project.root),
        projectRoot: project.root,
        policy: await readProjectPolicy(project.root),
      }),
      taskTools: {
        currentTaskId: task.id,
        currentRole: task.role || null,
        currentModel: model,
        currentSessionId: sessionId,
        appendNote: async ({ taskId, kind, text, source }) => appendTaskNote(project.root, taskId, {
          kind,
          text,
          source,
        }, { locale }),
        onTurnComplete: async ({ userInput, assistantMessage }) => {
          const taskDir = getTaskFolderPath(project.root, task);
          if (userInput) {
            await appendConversationMessage(taskDir, {
              id: createMessageId(),
              role: 'user',
              content: userInput,
              timestamp: new Date().toISOString(),
              provider: provider.name,
              model,
              sessionId,
            });
          }
          if (assistantMessage) {
            await appendConversationMessage(taskDir, {
              id: createMessageId(),
              role: 'assistant',
              content: assistantMessage,
              timestamp: new Date().toISOString(),
              provider: provider.name,
              model,
              sessionId,
            });
          }
          await setTaskLastSessionId(project.root, task.id, sessionId, locale);
        },
      },
      policy: await readProjectPolicy(project.root),
      t,
      promptLabel: t('agent.promptLabel'),
      exitHint: t('agent.exitHint'),
      helpHint: t('agent.helpHint'),
      initialConversationHistory: conversation.recentMessages,
    });
    return;
  }

  if (subcommand === 'auto') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const request = options.request || options._.slice(1).join(' ').trim();
    if (!request) {
      throw new Error(t('common.missingTaskRequest'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const state = await readProjectState(projectRoot);
    const provider = await getProvider(projectRoot, options.provider || state?.selectedProvider || null);
    const model = options.model || task.model || state?.selectedModel || provider.defaultModel;
    const policy = await readProjectPolicy(projectRoot);
    const autoMode = policy.autoMode || {};
    const taskInfo = await showTask(projectRoot, task.id, locale);
    const conversationSummary = await readConversationSummary(taskInfo.folderPath);
    const plan = await planAutoPhase(task.id, request, {
      projectRoot,
      provider,
      model,
      policy,
      retryMax: options.retryMax || autoMode.retryMax || 3,
      maxSteps: options.maxSteps || autoMode.maxSteps || 10,
      memorySummary: await summarizeCurrentMemory(projectRoot),
      taskContext: taskInfo.context,
      conversationSummary,
      allowedShellCommands: await listAllowedShellCommands(projectRoot),
      locale,
    });
    console.log(formatAutoPlan(plan, request, locale, t));
    if (options.dryRun) {
      console.log('');
      console.log(t('task.autoDryRunHint'));
      return;
    }

    const requireApproval = autoMode.requirePlanApproval !== false && !options.yes;
    if (requireApproval) {
      const approved = await promptConfirmation(t('task.autoPlanApprovePrompt'));
      if (!approved) {
        console.log(t('task.autoPlanRejected'));
        return;
      }
    }

    const result = await runAutoAgent(task.id, request, {
      projectRoot,
      provider,
      model,
      policy,
      autoMode,
      retryMax: options.retryMax || autoMode.retryMax || 3,
      maxSteps: options.maxSteps || autoMode.maxSteps || 10,
      testCommand: options.testCommand || autoMode.testCommand || null,
      noTests: options.noTests,
      locale,
      preplannedSteps: plan,
    });
    console.log(t('task.autoRunStarted', { runId: result.run.runId }));
    console.log(t('task.autoRunCompleted', { runId: result.run.runId }));
    if (result.summary) {
      console.log(result.summary);
    }
    return;
  }

  if (subcommand === 'run-status') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const run = await getAutoRunStatus(task.id, options.runId || null, { projectRoot });
    console.log(formatAutoRunStatus(run, task, locale, t));
    return;
  }

  if (subcommand === 'abort') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const run = await getAutoRunStatus(task.id, options.runId || null, { projectRoot });
    if (!run) {
      console.log(t('task.autoRunNotFound'));
      return;
    }
    const result = await abortAutoRun(task.id, run.runId, { projectRoot });
    if (result.aborted) {
      console.log(t('task.autoRunAborted', { runId: result.run.runId }));
      return;
    }
    console.log(t('task.autoRunAbortFailed'));
    return;
  }

  if (subcommand === 'runs') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingTaskId'));
    }
    const task = await resolveTask(projectRoot, id);
    if (!task) {
      console.log(t('common.taskNotFound', { id }));
      return;
    }
    const runs = await listAutoRuns(task.id, { projectRoot });
    console.log(t('task.autoRunsTitle', { id: task.id }));
    if (!runs.length) {
      console.log(t('task.autoRunsEmpty'));
      return;
    }
    for (const run of runs) {
      const totalSteps = Array.isArray(run.plan) ? run.plan.length : 0;
      const completedSteps = Array.isArray(run.plan) ? run.plan.filter((step) => step.status === 'completed').length : 0;
      console.log(`${run.runId}   ${formatDate(run.startedAt, locale)}   ${t(`task.autoRunState.${run.status}`)}   ${completedSteps}/${totalSteps}`);
    }
    return;
  }

  printUsage(t);
}

async function appendPatchValidationNotes(projectRoot, patch, validationResults, t, locale) {
  if (!patch?.taskId) {
    return;
  }

  const lines = [];
  if (!validationResults.length) {
    lines.push(t('patch.validationSkipped'));
  } else {
    for (const result of validationResults) {
      const label = result.skipped
        ? t('patch.validationSkipped')
        : result.ok
          ? t('patch.validationSuccess')
          : t('patch.validationFailed');
      const commandText = [result.command, ...(result.args || [])].filter(Boolean).join(' ');
      const details = result.message ? `: ${result.message}` : '';
      lines.push(`- ${commandText} — ${label}${details}`);
    }
  }

  await appendTaskNote(projectRoot, patch.taskId, {
    kind: 'validation result',
    text: lines.join('\n'),
    source: 'system',
  }, { locale });
}

async function handleDiffCommand(options, t) {
  const projectRoot = process.cwd();
  const selector = options.task || null;
  let pending = await getPendingPatch(projectRoot);

  if (selector) {
    const task = await resolveTask(projectRoot, selector);
    if (!task) {
      console.log(t('common.taskNotFound', { id: selector }));
      return;
    }
    pending = pending && pending.taskId === task.id ? pending : null;
    if (!pending) {
      console.log(t('patch.noTaskPending', { task: task.id }));
      return;
    }
  }

  if (!pending) {
    console.log(t('patch.noPending'));
    return;
  }

  console.log(t('patch.diffTitle'));
  console.log(formatPatchDiff(pending));
}

async function handlePatchCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  const policy = await readProjectPolicy(projectRoot);
  const currentStatus = await getPatchStatus(projectRoot);

  if (subcommand === 'status') {
    console.log(formatPatchStatus(currentStatus.latest, t));
    return;
  }

  if (subcommand === 'apply') {
    if (!currentStatus.pending) {
      console.log(t('patch.noPending'));
      return;
    }
    let result;
    try {
      result = await applyPatchArtifact(projectRoot, currentStatus.pending, {
        policy,
        t,
        promptApproval: () => promptConfirmation(t('patch.testsRollbackPrompt')),
      });
    } catch (error) {
      console.log(t('patch.applyFailed', { reason: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (!result.applied) {
      const failureReason = result.reason === 'freeze_mode_read_only'
        ? t('patch.freezeModeReadOnly')
        : result.reason || t('common.notSet');
      if (result.testOutcome?.rolledBack) {
        console.log(t('patch.applied', { id: result.patch.patchId }));
        console.log(t('patch.testsRollback'));
        if (result.validationResults.length) {
          for (const validation of result.validationResults) {
            const commandText = [validation.command, ...(validation.args || [])].filter(Boolean).join(' ');
            const label = validation.skipped
              ? t('patch.validationSkipped')
              : validation.ok
                ? t('patch.validationSuccess')
                : t('patch.validationFailed');
            console.log(`${commandText}: ${label}`);
          }
        }
        console.log(t('patch.rollbackDone'));
      } else {
        console.log(t('patch.applyFailed', { reason: failureReason }));
      }
      return;
    }
    console.log(t('patch.applied', { id: result.patch.patchId }));
    if (result.validationResults.length) {
      console.log(t('patch.testsStarted', { command: result.validationResults[0]?.command || t('common.notSet') }));
      for (const validation of result.validationResults) {
        const commandText = [validation.command, ...(validation.args || [])].filter(Boolean).join(' ');
        const label = validation.skipped
          ? t('patch.validationSkipped')
          : validation.ok
            ? t('patch.validationSuccess')
            : t('patch.validationFailed');
        console.log(`${commandText}: ${label}`);
      }
      if (result.testOutcome?.action === 'warn') {
        console.log(t('patch.testsWarn'));
      } else if (result.testOutcome?.action === 'rollback') {
        console.log(t('patch.testsRollback'));
      } else if (result.testOutcome?.action === 'ask') {
        console.log(t('patch.testsAsk'));
      }
    } else {
      console.log(t('patch.validationSkipped'));
    }
    await appendPatchValidationNotes(projectRoot, result.patch, result.validationResults, t, locale);
    return;
  }

  if (subcommand === 'reject') {
    if (!currentStatus.pending) {
      console.log(t('patch.noPending'));
      return;
    }
    const result = await rejectPatchArtifact(projectRoot, currentStatus.pending);
    if (!result.rejected) {
      console.log(t('patch.rejectFailed', { reason: result.reason || t('common.notSet') }));
      return;
    }
    console.log(t('patch.rejected', { id: result.patch.patchId }));
    return;
  }

  printUsage(t);
}

async function handleExtensionsCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureExtensionsWorkspace(projectRoot);

  if (['list', 'scaffold', 'info', 'enable', 'disable', 'remove'].includes(subcommand)) {
    if (subcommand === 'list') {
      const extensions = await listExtensions(projectRoot);
      console.log(t('extensions.listTitle'));
      if (!extensions.length) {
        console.log(t('extensions.empty'));
        return;
      }
      for (const entry of extensions) {
        printPluginSummary(entry, t);
        console.log('');
      }
      return;
    }

    if (subcommand === 'scaffold') {
      const name = options._[0];
      if (!name) {
        throw new Error(t('common.missingExtensionId'));
      }
      const hooks = String(options.hooks || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await scaffoldExtension(projectRoot, name, {
        global: options.global === true,
        hooks,
      });
      console.log(t('extensions.scaffolded', { path: result.directory }));
      console.log(`  ${t('extensions.scope')}: ${result.scope}`);
      return;
    }

    if (subcommand === 'info') {
      const name = options._[0];
      if (!name) {
        throw new Error(t('common.missingExtensionId'));
      }
      const info = await describeExtension(projectRoot, name);
      if (!info) {
        throw new Error(t('extensions.notFound', { id: name }));
      }
      console.log(t('extensions.pluginDetailsTitle'));
      printPluginDetails(info, t);
      return;
    }

    if (subcommand === 'enable') {
      const name = options._[0];
      if (!name) {
        throw new Error(t('common.missingExtensionId'));
      }
      const entry = await setLoadedExtensionEnabled(projectRoot, name, true);
      console.log(t('extensions.pluginEnabled', { id: entry.name || name }));
      return;
    }

    if (subcommand === 'disable') {
      const name = options._[0];
      if (!name) {
        throw new Error(t('common.missingExtensionId'));
      }
      const entry = await setLoadedExtensionEnabled(projectRoot, name, false);
      console.log(t('extensions.pluginDisabled', { id: entry.name || name }));
      return;
    }

    if (subcommand === 'remove') {
      const name = options._[0];
      if (!name) {
        throw new Error(t('common.missingExtensionId'));
      }
      if (!options.yes && !options.confirm) {
        const approved = await promptConfirmation(t('extensions.removePluginPrompt', { id: name }));
        if (!approved) {
          console.log(t('extensions.removeRejected'));
          return;
        }
      }
      const removed = await removeLoadedExtension(projectRoot, name);
      console.log(t('extensions.pluginRemoved', { id: removed.name || name }));
      return;
    }
  }

  if (subcommand === 'install') {
    const source = options._[0];
    if (!source) {
      throw new Error(t('common.missingExtensionSource'));
    }
    const preview = await previewExtensionInstall(projectRoot, source, { path: options.path, ref: options.ref });
    if (!preview.ok) {
      console.log(t('extensions.installInvalid'));
      for (const issue of preview.issues) {
        console.log(`- ${issue}`);
      }
      return;
    }

    console.log(t('extensions.installPreviewTitle'));
    console.log(t('extensions.rawGitHubWarning'));
    printExtensionSummary({
      id: preview.manifest.id,
      name: preview.manifest.name,
      version: preview.manifest.version,
      type: preview.manifest.type,
      author: preview.manifest.author,
      description: preview.manifest.description,
      capabilities: preview.manifest.capabilities,
      enabled: false,
      installPath: t('common.notSet'),
    }, t);
    console.log(`${t('extensions.manifestHash')}: ${preview.manifestHash}`);
    if (preview.risk?.requiresApproval) {
      console.log(t('extensions.approvalRequired'));
      for (const capability of preview.manifest.capabilities || []) {
        console.log(`- ${capability}`);
      }
    }

    if (preview.approvalRequired && !options.yes) {
      const approved = await promptConfirmation(t('extensions.approvalPrompt'));
      if (!approved) {
        console.log(t('extensions.installRejected'));
        return;
      }
    }

    const result = await installExtension(projectRoot, source, {
      path: options.path,
      ref: options.ref,
      confirm: true,
    });
    console.log(t('extensions.installed', { id: result.registryEntry.id, path: result.installPath }));
    console.log(t('extensions.disabledByDefault'));
    return;
  }

  if (subcommand === 'list') {
    const extensions = await listInstalledExtensions(projectRoot);
    console.log(t('extensions.listTitle'));
    if (!extensions.length) {
      console.log(t('extensions.empty'));
      return;
    }
    for (const entry of extensions) {
      printExtensionSummary(entry, t);
      console.log('');
    }
    return;
  }

  if (subcommand === 'show') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    const info = await inspectExtension(projectRoot, id);
    printExtensionDetails(info.entry, info.manifest, info.source, t);
    return;
  }

  if (subcommand === 'inspect') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    const info = await inspectExtension(projectRoot, id);
    console.log(t('extensions.inspectTitle'));
    printExtensionDetails(info.entry, info.manifest, info.source, t);
    return;
  }

  if (subcommand === 'remove') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    if (!options.yes) {
      const approved = await promptConfirmation(t('extensions.removePrompt', { id }));
      if (!approved) {
        console.log(t('extensions.removeRejected'));
        return;
      }
    }
    const entry = await removeExtension(projectRoot, id);
    console.log(t('extensions.removed', { id: entry.id }));
    return;
  }

  if (subcommand === 'update') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    if (!options.yes) {
      const approved = await promptConfirmation(t('extensions.updatePrompt', { id }));
      if (!approved) {
        console.log(t('extensions.updateRejected'));
        return;
      }
    }
    const result = await updateExtension(projectRoot, id, {
      path: options.path,
      ref: options.ref,
      confirm: true,
    });
    console.log(t('extensions.updated', { id: result.registryEntry.id || id }));
    return;
  }

  if (subcommand === 'enable') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    const entry = await enableExtension(projectRoot, id, { confirm: options.yes });
    console.log(t('extensions.enabled', { id: entry.id }));
    return;
  }

  if (subcommand === 'disable') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingExtensionId'));
    }
    const entry = await disableExtension(projectRoot, id);
    console.log(t('extensions.disabled', { id: entry.id }));
    return;
  }

  if (subcommand === 'doctor') {
    const report = await doctorExtensions(projectRoot);
    console.log(t('extensions.doctorTitle'));
    if (!report.extensions.length) {
      console.log(t('extensions.empty'));
      return;
    }
    console.log(t('extensions.doctorSummary', {
      total: report.extensions.length,
      issues: report.issues.length,
    }));
    if (!report.issues.length) {
      console.log(t('extensions.doctorHealthy'));
      return;
    }
    for (const issue of report.issues) {
      console.log(`[${issue.severity}] ${issue.id}: ${issue.message}`);
    }
    return;
  }

  printUsage(t);
}

async function handleRegistryCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureRegistryWorkspace(projectRoot);

  if (subcommand === 'add-source') {
    const source = options._[0];
    if (!source) {
      throw new Error(t('common.missingRegistrySource'));
    }
    const result = await addRegistrySource(projectRoot, source);
    console.log(result.added ? t('registry.sourceAdded', { id: result.source.id }) : t('registry.sourceExists', { id: result.source.id }));
    console.log(`${t('registry.sourceLocation')}: ${result.source.location}`);
    return;
  }

  if (subcommand === 'remove-source') {
    const idOrUrl = options._[0];
    if (!idOrUrl) {
      throw new Error(t('common.missingRegistrySource'));
    }
    const result = await removeRegistrySource(projectRoot, idOrUrl);
    if (!result.removed) {
      console.log(t('registry.sourceNotFound'));
      return;
    }
    console.log(t('registry.sourceRemoved', { id: idOrUrl }));
    return;
  }

  if (subcommand === 'refresh') {
    const catalog = await refreshRegistryCatalog(projectRoot);
    console.log(t('registry.refreshTitle'));
    console.log(t('registry.refreshSummary', { sources: catalog.sources.length, entries: catalog.entries.length }));
    if (!catalog.issues.length) {
      console.log(t('registry.refreshHealthy'));
      return;
    }
    for (const issue of catalog.issues) {
      console.log(`[${issue.severity}] ${issue.sourceId || issue.id}: ${issue.message}`);
    }
    return;
  }

  if (subcommand === 'list') {
    const catalog = await getRegistryCatalog(projectRoot);
    console.log(t('registry.listTitle'));
    console.log(t('registry.sourceSummary', { total: catalog.sources.length, enabled: catalog.sources.filter((source) => source.enabled).length }));
    if (!catalog.entries.length) {
      console.log(t('registry.empty'));
      return;
    }
    for (const entry of catalog.entries) {
      printRegistrySummary(entry, t);
      console.log('');
    }
    return;
  }

  if (subcommand === 'show') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingRegistryId'));
    }
    const entry = await getRegistryEntry(projectRoot, id);
    if (!entry) {
      throw new Error(t('registry.entryNotFound', { id }));
    }
    console.log(t('registry.detailsTitle'));
    printRegistryDetails(entry, t);
    return;
  }

  if (subcommand === 'install') {
    const id = options._[0];
    if (!id) {
      throw new Error(t('common.missingRegistryId'));
    }
    const entry = await getRegistryEntry(projectRoot, id);
    if (!entry) {
      throw new Error(t('registry.entryNotFound', { id }));
    }
    const preview = await previewExtensionInstall(projectRoot, entry.source, {
      path: entry.source.subdirectory,
      ref: entry.source.ref,
      manifestPath: entry.manifestPath,
    });
    if (!preview.ok) {
      console.log(t('registry.installInvalid'));
      for (const issue of preview.issues) {
        console.log(`- ${issue}`);
      }
      return;
    }
    console.log(t('registry.installPreviewTitle'));
    printRegistrySummary(entry, t);
    console.log(`${t('registry.manifestPath')}: ${entry.manifestPath}`);
    console.log(`${t('registry.rawSourcePath')}: ${entry.registrySourceLocation || t('common.notSet')}`);
    if (entry.reviewStatus !== 'reviewed' && entry.reviewStatus !== 'trusted') {
      console.log(t('registry.installLessTrusted'));
    } else {
      console.log(t('registry.installTrusted'));
    }
    if (preview.approvalRequired) {
      console.log(t('registry.installApprovalRequired'));
    }
    if (!options.yes) {
      const approved = await promptConfirmation(t('registry.installPrompt', { id }));
      if (!approved) {
        console.log(t('registry.installRejected'));
        return;
      }
    }
    const result = await installRegistryEntry(projectRoot, id);
    console.log(t('registry.installed', { id: result.registryEntry.id, path: result.installPath }));
    console.log(t('extensions.disabledByDefault'));
    return;
  }

  if (subcommand === 'doctor') {
    const report = await doctorRegistryCatalog(projectRoot);
    console.log(t('registry.doctorTitle'));
    console.log(t('registry.doctorSummary', { sources: report.sources.length, entries: report.catalog.length, issues: report.issues.length }));
    if (report.issues.length === 0) {
      console.log(t('registry.doctorHealthy'));
      return;
    }
    for (const issue of report.issues) {
      console.log(`[${issue.severity}] ${issue.sourceId || issue.id}: ${issue.message}`);
    }
    return;
  }

  printUsage(t);
}

async function main() {
  const [, , command = 'help', subcommand, ...rest] = process.argv;
  const { t, locale } = await getTranslator();
  const options = parseOptions(rest);

  if (command === 'help' || options.help) {
    printUsage(t);
    return;
  }

  if ((command === 'model' || command === 'models') && subcommand === 'list') {
    const projectRoot = process.cwd();
    const provider = await getProvider(projectRoot);
    const models = await provider.listModels();
    if (!models.length) {
      console.log(t('provider.noModels', { provider: provider.name }));
      return;
    }
    console.log(t('provider.modelsTitle', { provider: provider.name }));
    for (const model of models) {
      console.log(model?.id || model);
    }
    return;
  }

  if (command === 'roles') {
    await handleRolesCommand(subcommand, options, t);
    return;
  }

  if (command === 'project') {
    await handleProjectCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'index') {
    await handleIndexCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'search') {
    await handleSearchCommand(options, t, locale);
    return;
  }

  if (command === 'provider') {
    await handleProviderCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'test') {
    await handleTestCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'server') {
    await handleServerCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'hooks') {
    await handleHooksCommand(subcommand, options, t);
    return;
  }

  if (command === 'budget') {
    const budgetSubcommand = subcommand && subcommand.startsWith('-') ? null : subcommand;
    const budgetOptions = budgetSubcommand ? options : parseOptions([subcommand, ...rest].filter((value) => value !== undefined));
    await handleBudgetCommand(budgetSubcommand, budgetOptions, t, locale);
    return;
  }

  if (command === 'stats') {
    const statsSubcommands = new Set(['refresh', 'prune', 'export']);
    const statsSubcommand = statsSubcommands.has(subcommand) ? subcommand : null;
    const statsOptions = statsSubcommand ? options : parseOptions([subcommand, ...rest].filter((value) => value !== undefined));
    await handleStatsCommand(statsSubcommand, statsOptions, t, locale);
    return;
  }

  if (command === 'workspace') {
    await handleWorkspaceCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'memory') {
    await handleMemoryCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'prompt') {
    await handlePromptCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'task') {
    await handleTaskCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'diff') {
    await handleDiffCommand(options, t);
    return;
  }

  if (command === 'patch') {
    await handlePatchCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'extensions') {
    await handleExtensionsCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'registry') {
    await handleRegistryCommand(subcommand, options, t, locale);
    return;
  }

  if (command === 'ext') {
    if (!subcommand) {
      printUsage(t);
      return;
    }
    const policy = await readProjectPolicy(process.cwd()).catch(() => null);
    const result = await runExtensionCommand(process.cwd(), subcommand, options._, { policy });
    if (result !== undefined) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    return;
  }

  if (command === 'tree') {
    const projectPath = subcommand;
    if (!projectPath) {
      throw new Error(t('errors.projectPathMissing'));
    }
    const project = await openProject(projectPath);
    const tree = await formatProjectTree(project.root, options.depth || 3);
    console.log(tree);
    return;
  }

  if (command === 'start') {
    const projectPath = subcommand;
    if (!projectPath) {
      throw new Error(t('errors.projectPathMissing'));
    }
    await runProjectStart(projectPath, options, t, locale);
    return;
  }

  try {
    const policy = await readProjectPolicy(process.cwd()).catch(() => null);
    const result = await runExtensionCommand(process.cwd(), command, [subcommand, ...rest].filter((value) => value !== undefined), { policy });
    if (result !== undefined) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    return;
  } catch (error) {
    if (!String(error?.message || '').includes('Command not found')) {
      throw error;
    }
  }

  printUsage(t);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
