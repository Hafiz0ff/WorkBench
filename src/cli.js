#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { listModels } from './ollama.js';
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
  generateTaskPlan,
  appendTaskNote,
  markTaskDone,
  archiveTask,
  getTaskWorkspaceStatus,
  getCurrentTaskContext,
  resolveTask,
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
import { BASE_SYSTEM_INSTRUCTIONS, composePromptLayers, formatPromptInspection } from './prompt-composer.js';
import {
  applyPatchArtifact,
  formatPatchDiff,
  formatPatchStatus,
  getPatchStatus,
  getPendingPatch,
  rejectPatchArtifact,
} from './patches.js';

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--model') {
      options.model = argv[++i];
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
    if (value === '--task') {
      options.task = argv[++i];
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
    const { memoryRoot } = await ensureProjectMemory(projectRoot);
    await ensureProjectPolicy(projectRoot);
    await ensureTaskWorkspace(projectRoot);
    await ensureExtensionsWorkspace(projectRoot);
    await ensureRegistryWorkspace(projectRoot);
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
  const taskContext = await getCurrentTaskContext(projectRoot, locale);
  const extensionPrompts = await listEnabledExtensionPromptPacks(projectRoot);
  const taskInstruction = options.task || '';
  const allowedShellCommands = await listAllowedShellCommands(projectRoot);
  const composition = await composePromptLayers({
    baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
    roleProfile,
    memorySummary,
    taskContext,
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
    const currentContext = await getCurrentTaskContext(projectRoot, locale);
    const memorySummary = await summarizeCurrentMemory(projectRoot);
    const context = [memorySummary, currentContext].filter(Boolean).join('\n\n');
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
      result = await applyPatchArtifact(projectRoot, currentStatus.pending, { policy, t });
    } catch (error) {
      console.log(t('patch.applyFailed', { reason: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (!result.applied) {
      console.log(t('patch.applyFailed', { reason: result.reason || t('common.notSet') }));
      return;
    }
    console.log(t('patch.applied', { id: result.patch.patchId }));
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

  if (command === 'models' && subcommand === 'list') {
    const models = await listModels();
    if (models.length === 0) {
      console.log(t('common.noLocalModels'));
      return;
    }
    for (const model of models) {
      const size = typeof model.size === 'number' ? ` (${Math.round(model.size / 1024 / 1024)} MB)` : '';
      console.log(`${model.name}${size}`);
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
    await scaffoldBuiltInRoles(project.root);
    await ensureProjectMemory(project.root);
    await ensureTaskWorkspace(project.root);
    await ensureProjectPolicy(project.root);
    await ensureRegistryWorkspace(project.root);

    const state = await readProjectState(project.root);
    const policy = await readProjectPolicy(project.root);
    const model = options.model || state?.selectedModel || 'qwen2.5-coder:14b';
    const resolvedRole = await resolveRoleSelection(project.root, options.role || state?.activeRole || null);
    const currentTask = await getCurrentTask(project.root);
    await updateProjectState(project.root, {
      activeRole: resolvedRole.name,
      selectedModel: model,
      currentTaskId: currentTask?.id || null,
    });

    const memoryContext = await summarizeCurrentMemory(project.root);
    const taskContext = currentTask ? await getCurrentTaskContext(project.root, locale) : '';
    const extensionPrompts = await listEnabledExtensionPromptPacks(project.root);
    const allowedShellCommands = await listAllowedShellCommands(project.root);
    console.log(`${t('common.projectRoot')}: ${project.root}`);
    console.log(t('common.activeRole', { role: resolvedRole.name }));
    console.log(t('common.selectedModel', { model }));
    console.log(t('common.currentTask', { id: currentTask ? `${currentTask.id} (${currentTask.title})` : t('common.notSet') }));

    await runInteractiveAgent({
      root: project.root,
      model,
      promptLabel: t('agent.promptLabel'),
      exitHint: t('agent.exitHint'),
      helpHint: t('agent.helpHint'),
      composePromptForTask: async (taskInstruction) => composePromptLayers({
        baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
        roleProfile: resolvedRole,
        memorySummary: memoryContext,
        taskContext,
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
        appendNote: async ({ taskId, kind, text, source }) => appendTaskNote(project.root, taskId, {
          kind,
          text,
          source,
        }, { locale }),
        onTurnComplete: async ({ assistantMessage, toolResults }) => {
          const pieces = [];
          if (assistantMessage) {
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
