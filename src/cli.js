#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
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
import { ensureProjectPolicy, getPolicyPath, readProjectPolicy } from './policy.js';
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
  listInstalledExtensions,
  previewExtensionInstall,
  installExtension,
  removeExtension,
  updateExtension,
  inspectExtension,
  doctorExtensions,
  enableExtension,
  disableExtension,
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
  setProviderApiKey,
  useProvider,
} from './providers/index.js';
import { BASE_SYSTEM_INSTRUCTIONS, composePromptLayers, formatPromptInspection } from './prompt-composer.js';
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
    if (value === '--depth') {
      options.depth = Number(argv[++i]);
      continue;
    }
    if (value === '--limit') {
      options.limit = Number(argv[++i]);
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
    if (value === '--dry-run') {
      options.dryRun = true;
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
  return t('provider.healthFailed', { reason: health.message || t('common.notSet') });
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
  console.log(`  ${t('provider.defaultModel')}: ${entry.defaultModel || t('common.notSet')}`);
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

async function handleProjectCommand(subcommand, t, locale) {
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

  if (subcommand === 'refresh') {
    const { state, moduleSummaries } = await refreshProjectMemory(projectRoot);
    console.log(t('project.refreshed', { root: state.projectRoot }));
    console.log(t('project.moduleSummaries', { count: moduleSummaries.length }));
    console.log(t('common.lastRefresh', { value: formatDate(state.lastRefreshAt, locale) }));
    return;
  }

  if (subcommand === 'summary') {
    const summary = await summarizeCurrentMemory(projectRoot);
    console.log(`${t('project.summaryHeader')}\n${summary}`);
    return;
  }

  printUsage(t);
}

async function handleProviderCommand(subcommand, options, t, locale) {
  const projectRoot = process.cwd();
  await ensureProvidersWorkspace(projectRoot);

  if (subcommand === 'list') {
    const catalog = await listProviderSummaries(projectRoot);
    console.log(t('provider.listTitle'));
    console.log(t('provider.defaultLabel', { provider: catalog.defaultProvider }));
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
    const provider = await useProvider(projectRoot, name);
    console.log(t('provider.used', { provider: provider.name, model: provider.defaultModel }));
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

  if (subcommand === 'health') {
    const catalog = await listProviderSummaries(projectRoot);
    console.log(t('provider.healthTitle'));
    for (const entry of catalog.providers.filter((provider) => provider.enabled)) {
      const label = entry.health.ok
        ? t('provider.healthOk')
        : t('provider.healthFailed', { reason: entry.health.message || t('common.notSet') });
      console.log(`${entry.name}: ${label}`);
    }
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
        console.log(t('patch.applyFailed', { reason: result.reason || t('common.notSet') }));
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
      console.log(model);
    }
    return;
  }

  if (command === 'roles') {
    await handleRolesCommand(subcommand, options, t);
    return;
  }

  if (command === 'project') {
    await handleProjectCommand(subcommand, t, locale);
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
    const project = await openProject(projectPath);
    await prepareProjectWorkspace(project.root, { scaffoldRoles: true });

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
    return;
  }

  printUsage(t);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
