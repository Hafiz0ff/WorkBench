import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { ensureProjectMemory, readProjectState, updateProjectState } from './memory.js';
import { getCurrentRoleSelection, loadRoleProfile } from './roles.js';
import { createTranslator, getDefaultLocale } from './i18n.js';

const TASKS_DIR_NAME = path.join('.local-codex', 'tasks');
const TASKS_SCHEMA_VERSION = 1;
const GENERATED_START = '<!-- GENERATED START -->';
const GENERATED_END = '<!-- GENERATED END -->';
const MANUAL_START = '<!-- MANUAL NOTES START -->';
const MANUAL_END = '<!-- MANUAL NOTES END -->';
const DEFAULT_MANUAL_PLACEHOLDER = '<!-- Добавьте ручные заметки здесь. -->';
const FOLDER_KINDS = {
  active: 'active',
  archive: 'archive',
  templates: 'templates',
};
const TASK_STATUSES = new Set(['draft', 'planned', 'in_progress', 'blocked', 'done', 'archived']);

function nowIso() {
  return new Date().toISOString();
}

function formatTimestamp(value, locale = 'ru') {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.writeFile(tempPath, content, encoding).then(() => fs.rename(tempPath, filePath));
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

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readTextFile(filePath));
  } catch {
    return null;
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getTasksRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), TASKS_DIR_NAME);
}

function getIndexPath(projectRoot) {
  return path.join(getTasksRoot(projectRoot), 'index.json');
}

function getTaskFolder(projectRoot, location, id) {
  return path.join(getTasksRoot(projectRoot), location, id);
}

function getTaskFilePath(projectRoot, location, id, fileName) {
  return path.join(getTaskFolder(projectRoot, location, id), fileName);
}

function normalizeTaskSelector(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Не указан идентификатор задачи.');
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(`Недопустимый идентификатор задачи: ${value}`);
  }
  return trimmed;
}

function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'task';
}

function formatBulletList(values) {
  if (!values.length) {
    return '-';
  }
  return values.map((value) => `- ${value}`).join('\n');
}

function extractBlock(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return content.slice(start + startMarker.length, end).trim();
}

function extractManualNotes(existingContent) {
  if (!existingContent) {
    return DEFAULT_MANUAL_PLACEHOLDER;
  }
  const manual = extractBlock(existingContent, MANUAL_START, MANUAL_END);
  if (manual !== null) {
    return manual || DEFAULT_MANUAL_PLACEHOLDER;
  }
  const trimmed = existingContent.trim();
  return trimmed || DEFAULT_MANUAL_PLACEHOLDER;
}

function renderSectionedDocument({ title, generated, manualNotes, existingContent }) {
  const manual = manualNotes ?? extractManualNotes(existingContent);
  return [
    `# ${title}`,
    '',
    GENERATED_START,
    generated.trim(),
    GENERATED_END,
    '',
    MANUAL_START,
    manual.trim() || DEFAULT_MANUAL_PLACEHOLDER,
    MANUAL_END,
    '',
  ].join('\n');
}

function getStatusLabel(status, t) {
  const map = {
    draft: t('task.statusDraft'),
    planned: t('task.statusPlanned'),
    in_progress: t('task.statusInProgress'),
    blocked: t('task.statusBlocked'),
    done: t('task.statusDone'),
    archived: t('task.statusArchived'),
  };
  return map[status] || status;
}

function renderTaskMarkdown(task, t) {
  return renderSectionedDocument({
    title: task.title,
    generated: [
      `- ID: \`${task.id}\``,
      `- Slug: \`${task.slug}\``,
      `- ${t('task.status')}: ${getStatusLabel(task.status, t)}`,
      `- ${t('task.role')}: ${task.role || t('common.notSet')}`,
      `- ${t('task.model')}: ${task.model || t('common.notSet')}`,
      `- ${t('common.createdAt', { value: formatTimestamp(task.createdAt) })}`,
      `- ${t('common.updatedAt', { value: formatTimestamp(task.updatedAt) })}`,
      `- ${t('task.summary')}: ${task.summary || t('common.notSet')}`,
      '',
      `## ${t('task.request')}`,
      task.userRequest || t('common.notSet'),
      '',
      `## ${t('task.relevantFiles')}`,
      task.relevantFiles.length ? formatBulletList(task.relevantFiles) : `- ${t('common.notSet')}`,
      '',
      `## ${t('task.lastRunNotes')}`,
      task.lastRunNotes.length
        ? formatBulletList(task.lastRunNotes.slice(0, 5).map((note) => `[${note.kind}] ${note.text}`))
        : `- ${t('common.notSet')}`,
    ].join('\n'),
  });
}

function renderPlanMarkdown(task, context, existingContent, t, locale = 'ru') {
  const generated = [
    `- ${t('task.planGeneratedAt')}: ${formatTimestamp(nowIso(), locale)}`,
    `- ${t('task.status')}: ${getStatusLabel(task.status, t)}`,
    '',
    `## ${t('task.summary')}`,
    task.summary || task.title,
    '',
    `## ${t('task.planFiles')}`,
    task.relevantFiles.length ? formatBulletList(task.relevantFiles.map((file) => `\`${file}\``)) : `- ${t('common.notSet')}`,
    '',
    `## ${t('task.planSteps')}`,
    [
      '1. Понять текущую реализацию в целевых файлах и соседних модулях.',
      '2. Внести минимальные изменения без лишнего расширения объёма задачи.',
      '3. Проверить крайние случаи и убедиться, что изменения остаются внутри корня проекта.',
    ].join('\n'),
    '',
    `## ${t('task.planValidation')}`,
    [
      `- ${t('task.planValidation')}: прогнать релевантные тесты.`,
      `- ${t('task.planValidation')}: вручную проверить основной сценарий из запроса пользователя.`,
      `- ${t('task.planValidation')}: убедиться, что конфиги и вызовы не сломаны.`,
    ].join('\n'),
    '',
    `## ${t('task.planNotes')}`,
    context || t('common.notSet'),
    '',
    `## ${t('task.planLimit')}`,
    t('task.planKeepShort'),
  ].join('\n');

  return renderSectionedDocument({
    title: `План: ${task.title}`,
    generated,
    existingContent,
  });
}

function renderNotesEntry(note, t, locale = 'ru') {
  return [
    `## ${formatTimestamp(note.createdAt, locale)}`,
    `- ${t('task.noteKind')}: ${note.kind}`,
    `- ${t('task.noteSource')}: ${note.source}`,
    `- ${t('task.noteText')}: ${note.text}`,
    '',
  ].join('\n');
}

function renderArtifactsMarkdown(task, existingContent, t) {
  const generated = [
    `## ${t('task.artifacts')}`,
    '- Ссылки на изменённые файлы.',
    '- Короткие выдержки из проверок.',
    '- Результаты команд, скриншоты или заметки о поведении.',
    '',
    `## ${t('task.currentTitle')}`,
    `- ${task.id}`,
    `- ${task.title}`,
  ].join('\n');

  return renderSectionedDocument({
    title: `Артефакты: ${task.title}`,
    generated,
    existingContent,
  });
}

async function readIndex(projectRoot) {
  const index = await readJsonFile(getIndexPath(projectRoot));
  if (!index) {
    return {
      schemaVersion: TASKS_SCHEMA_VERSION,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      currentTaskId: null,
      tasks: [],
    };
  }
  return {
    schemaVersion: TASKS_SCHEMA_VERSION,
    createdAt: index.createdAt || nowIso(),
    updatedAt: index.updatedAt || nowIso(),
    currentTaskId: index.currentTaskId || null,
    tasks: Array.isArray(index.tasks) ? index.tasks : [],
  };
}

async function writeIndex(projectRoot, index) {
  const next = {
    schemaVersion: TASKS_SCHEMA_VERSION,
    createdAt: index.createdAt || nowIso(),
    updatedAt: nowIso(),
    currentTaskId: index.currentTaskId || null,
    tasks: Array.isArray(index.tasks) ? index.tasks : [],
  };
  await atomicWriteFile(getIndexPath(projectRoot), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function normalizeRelevantFiles(projectRoot, files = []) {
  const root = normalizeRoot(projectRoot);
  const normalized = [];
  for (const file of files) {
    if (!file) {
      continue;
    }
    const text = String(file).trim();
    if (!text) {
      continue;
    }
    const resolved = resolveWithinRoot(root, text);
    normalized.push(path.relative(root, resolved));
  }
  return [...new Set(normalized)];
}

function normalizeStatus(value) {
  const status = String(value || 'draft').trim().toLowerCase();
  if (!TASK_STATUSES.has(status)) {
    throw new Error(`Недопустимый статус задачи: ${value}`);
  }
  return status;
}

async function readTaskStatus(projectRoot, location, id) {
  const status = await readJsonFile(getTaskFilePath(projectRoot, location, id, 'status.json'));
  if (!status) {
    return null;
  }
  return {
    ...status,
    relevantFiles: Array.isArray(status.relevantFiles) ? status.relevantFiles : [],
    lastRunNotes: Array.isArray(status.lastRunNotes) ? status.lastRunNotes : [],
  };
}

async function writeTaskStatus(projectRoot, location, id, status) {
  await atomicWriteFile(getTaskFilePath(projectRoot, location, id, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
  return status;
}

async function writeTaskMarkdownFiles(projectRoot, location, id, task, t, locale = 'ru') {
  const folder = getTaskFolder(projectRoot, location, id);
  await ensureDirectory(folder);

  const taskPath = getTaskFilePath(projectRoot, location, id, 'task.md');
  const planPath = getTaskFilePath(projectRoot, location, id, 'plan.md');
  const notesPath = getTaskFilePath(projectRoot, location, id, 'notes.md');
  const artifactsPath = getTaskFilePath(projectRoot, location, id, 'artifacts.md');

  const existingTask = await readTextFile(taskPath).catch(() => '');
  const existingPlan = await readTextFile(planPath).catch(() => '');
  const existingNotes = await readTextFile(notesPath).catch(() => '');
  const existingArtifacts = await readTextFile(artifactsPath).catch(() => '');

  await atomicWriteFile(taskPath, renderTaskMarkdown(task, t));
  await atomicWriteFile(planPath, renderPlanMarkdown(task, '', existingPlan, t, locale));
  if (!existingNotes) {
    await atomicWriteFile(
      notesPath,
      [
        `# ${t('task.notes')}: ${task.title}`,
        '',
        renderNotesEntry({
          kind: 'created',
          source: 'system',
          text: t('task.created', { id: task.id }),
          createdAt: task.createdAt,
        }, t, locale),
      ].join('\n'),
    );
  }
  await atomicWriteFile(artifactsPath, renderArtifactsMarkdown(task, existingArtifacts, t));
  if (existingTask && existingTask === renderTaskMarkdown(task, t)) {
    return;
  }
}

function upsertIndexRecord(index, task, location) {
  const nextTasks = index.tasks.filter((entry) => entry.id !== task.id);
  nextTasks.push({
    id: task.id,
    title: task.title,
    slug: task.slug,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    role: task.role,
    model: task.model,
    summary: task.summary,
    userRequest: task.userRequest,
    relevantFiles: task.relevantFiles,
    lastRunNotes: task.lastRunNotes,
    location,
    folder: path.join(location, task.id),
  });
  nextTasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    ...index,
    tasks: nextTasks,
  };
}

function cloneTask(task, patch = {}) {
  return {
    ...task,
    ...patch,
    relevantFiles: Array.isArray(patch.relevantFiles) ? patch.relevantFiles : task.relevantFiles,
    lastRunNotes: Array.isArray(patch.lastRunNotes) ? patch.lastRunNotes : task.lastRunNotes,
    updatedAt: patch.updatedAt || nowIso(),
  };
}

async function resolveTaskRecord(projectRoot, idOrSlug) {
  const selector = normalizeTaskSelector(idOrSlug);
  const index = await readIndex(projectRoot);
  const matches = index.tasks.filter((task) => task.id === selector || task.slug === selector);
  if (!matches.length) {
    return null;
  }
  matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return matches[0];
}

function buildTaskContext(task, t) {
  const noteLines = task.lastRunNotes.length
    ? task.lastRunNotes.slice(0, 3).map((note) => `- [${note.kind}] ${note.text}`)
    : ['-'];
  return [
    `# ${task.title}`,
    `${t('task.status')}: ${getStatusLabel(task.status, t)}`,
    `${t('task.role')}: ${task.role || t('common.notSet')}`,
    `${t('task.model')}: ${task.model || t('common.notSet')}`,
    `${t('task.summary')}: ${task.summary || t('common.notSet')}`,
    '',
    `${t('task.request')}:`,
    task.userRequest || t('common.notSet'),
    '',
    `${t('task.relevantFiles')}:`,
    task.relevantFiles.length ? formatBulletList(task.relevantFiles) : '-',
    '',
    `${t('task.lastRunNotes')}:`,
    ...noteLines,
  ].join('\n');
}

function formatTaskDetails(task, t) {
  return [
    `${t('task.status')}: ${getStatusLabel(task.status, t)}`,
    `${t('task.role')}: ${task.role || t('common.notSet')}`,
    `${t('task.model')}: ${task.model || t('common.notSet')}`,
    `${t('task.summary')}: ${task.summary || t('common.notSet')}`,
    `${t('task.request')}: ${task.userRequest || t('common.notSet')}`,
    `${t('task.relevantFiles')}: ${task.relevantFiles.length ? task.relevantFiles.join(', ') : t('common.notSet')}`,
    `${t('task.lastRunNotes')}:`,
    task.lastRunNotes.length
      ? task.lastRunNotes.slice(0, 5).map((note) => `- [${note.kind}] ${note.text}`).join('\n')
      : `- ${t('common.notSet')}`,
    '',
    `${t('common.createdAt', { value: formatTimestamp(task.createdAt) })}`,
    `${t('common.updatedAt', { value: formatTimestamp(task.updatedAt) })}`,
  ].join('\n');
}

async function allocateTaskId(projectRoot, title) {
  const datePrefix = nowIso().slice(0, 10);
  const baseSlug = slugify(title);
  const tasksRoot = getTasksRoot(projectRoot);
  let candidate = `task-${datePrefix}-${baseSlug}`;
  let counter = 2;
  while (
    await fileExists(path.join(tasksRoot, FOLDER_KINDS.active, candidate))
    || await fileExists(path.join(tasksRoot, FOLDER_KINDS.archive, candidate))
  ) {
    candidate = `task-${datePrefix}-${baseSlug}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export async function ensureTaskWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureProjectMemory(root);
  const tasksRoot = getTasksRoot(root);
  await ensureDirectory(tasksRoot);
  await ensureDirectory(path.join(tasksRoot, FOLDER_KINDS.active));
  await ensureDirectory(path.join(tasksRoot, FOLDER_KINDS.archive));
  await ensureDirectory(path.join(tasksRoot, FOLDER_KINDS.templates));
  if (!(await fileExists(getIndexPath(root)))) {
    await atomicWriteFile(
      getIndexPath(root),
      `${JSON.stringify({
        schemaVersion: TASKS_SCHEMA_VERSION,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        currentTaskId: null,
        tasks: [],
      }, null, 2)}\n`,
    );
  }
  return {
    tasksRoot,
    indexPath: getIndexPath(root),
  };
}

export async function createTask(projectRoot, input = {}, locale = getDefaultLocale()) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  await ensureTaskWorkspace(root);

  const title = String(input.title || '').trim();
  if (!title) {
    throw new Error(t('common.missingTaskTitle'));
  }

  const state = await readProjectState(root);
  const currentRole = input.role || state?.activeRole || null;
  const currentModel = input.model || state?.selectedModel || null;
  const currentRoleProfile = input.role
    ? await loadRoleProfile(root, input.role)
    : (state?.activeRole ? await getCurrentRoleSelection(root) : null);
  const id = await allocateTaskId(root, title);
  const task = {
    schemaVersion: TASKS_SCHEMA_VERSION,
    id,
    title,
    slug: slugify(title),
    status: normalizeStatus(input.status || 'draft'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    role: currentRoleProfile?.name || currentRole || null,
    model: currentModel,
    summary: String(input.summary || input.userRequest || title).trim(),
    userRequest: String(input.userRequest || title).trim(),
    relevantFiles: normalizeRelevantFiles(root, input.relevantFiles || []),
    lastRunNotes: [],
  };

  const folder = getTaskFolder(root, FOLDER_KINDS.active, id);
  await ensureDirectory(folder);
  await writeTaskMarkdownFiles(root, FOLDER_KINDS.active, id, task, t, locale);
  await writeTaskStatus(root, FOLDER_KINDS.active, id, task);

  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, task, FOLDER_KINDS.active));

  return {
    ...task,
    location: FOLDER_KINDS.active,
    folderPath: folder,
  };
}

export async function listTasks(projectRoot, locale = getDefaultLocale()) {
  const root = normalizeRoot(projectRoot);
  await ensureTaskWorkspace(root);
  const t = await createTranslator(locale);
  const index = await readIndex(root);
  const state = await readProjectState(root);
  const tasks = [...index.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    tasks,
    currentTaskId: state?.currentTaskId || null,
    emptyMessage: t('task.listEmpty'),
    formatTaskSummary(task) {
      const current = state?.currentTaskId === task.id;
      const marker = current ? '*' : ' ';
      return [
        `${marker} ${task.id}`,
        `  ${task.title}`,
        `  ${t('task.status')}: ${getStatusLabel(task.status, t)}`,
        `  ${t('task.role')}: ${task.role || t('common.notSet')}`,
        `  ${t('task.model')}: ${task.model || t('common.notSet')}`,
        `  ${t('task.summary')}: ${task.summary || t('common.notSet')}`,
        `  ${t('task.relevantFiles')}: ${task.relevantFiles.length ? task.relevantFiles.slice(0, 3).join(', ') : t('common.notSet')}`,
      ].join('\n');
    },
  };
}

export async function resolveTask(projectRoot, idOrSlug) {
  const root = normalizeRoot(projectRoot);
  await ensureTaskWorkspace(root);
  return resolveTaskRecord(root, idOrSlug);
}

export async function getCurrentTask(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const state = await readProjectState(root);
  if (!state?.currentTaskId) {
    return null;
  }
  return resolveTask(root, state.currentTaskId);
}

export async function setCurrentTask(projectRoot, idOrSlug, locale = getDefaultLocale()) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }

  const nextStatus = task.status === 'done' || task.status === 'archived' ? task.status : 'in_progress';
  const nextTask = cloneTask(task, { status: nextStatus });
  await writeTaskStatus(root, task.location || FOLDER_KINDS.active, task.id, nextTask);
  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, { ...nextTask, location: task.location || FOLDER_KINDS.active }, task.location || FOLDER_KINDS.active));
  await updateProjectState(root, {
    currentTaskId: task.id,
  });
  return {
    ...nextTask,
    location: task.location || FOLDER_KINDS.active,
  };
}

export async function getCurrentTaskContext(projectRoot, locale = getDefaultLocale()) {
  const root = normalizeRoot(projectRoot);
  const task = await getCurrentTask(root);
  if (!task) {
    return '';
  }
  const t = await createTranslator(locale);
  return buildTaskContext(task, t);
}

export async function showTask(projectRoot, idOrSlug, locale = getDefaultLocale()) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }
  const location = task.location || FOLDER_KINDS.active;
  return {
    task,
    folderPath: getTaskFolder(root, location, task.id),
    taskMarkdown: await readTextFile(getTaskFilePath(root, location, task.id, 'task.md')).catch(() => ''),
    planMarkdown: await readTextFile(getTaskFilePath(root, location, task.id, 'plan.md')).catch(() => ''),
    notesMarkdown: await readTextFile(getTaskFilePath(root, location, task.id, 'notes.md')).catch(() => ''),
    artifactsMarkdown: await readTextFile(getTaskFilePath(root, location, task.id, 'artifacts.md')).catch(() => ''),
    details: formatTaskDetails(task, t),
    context: buildTaskContext(task, t),
  };
}

export async function generateTaskPlan(projectRoot, idOrSlug, { locale = getDefaultLocale(), context = '' } = {}) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }
  const location = task.location || FOLDER_KINDS.active;
  const existing = await readTextFile(getTaskFilePath(root, location, task.id, 'plan.md')).catch(() => '');
  const nextPlan = renderPlanMarkdown(task, context, existing, t, locale);
  await atomicWriteFile(getTaskFilePath(root, location, task.id, 'plan.md'), nextPlan);
  const nextTask = cloneTask(task, {
    status: task.status === 'draft' ? 'planned' : task.status,
  });
  await writeTaskStatus(root, location, task.id, nextTask);
  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, { ...nextTask, location }, location));
  return {
    task: { ...nextTask, location },
    planPath: getTaskFilePath(root, location, task.id, 'plan.md'),
    content: nextPlan,
  };
}

export async function appendTaskNote(projectRoot, idOrSlug, note, { locale = getDefaultLocale() } = {}) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }
  const location = task.location || FOLDER_KINDS.active;
  const text = String(note?.text || '').trim();
  if (!text) {
    throw new Error(t('common.missingNoteText'));
  }

  const entry = {
    kind: note?.kind || 'note',
    source: note?.source || 'cli',
    text,
    createdAt: note?.createdAt || nowIso(),
  };
  const notesPath = getTaskFilePath(root, location, task.id, 'notes.md');
  const currentContent = await readTextFile(notesPath).catch(() => '');
  const nextContent = `${currentContent.trimEnd()}\n\n${renderNotesEntry(entry, t, locale)}`.replace(/^\n+/, '');
  await atomicWriteFile(notesPath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`);
  const nextTask = cloneTask(task, {
    lastRunNotes: [entry, ...task.lastRunNotes].slice(0, 10),
  });
  await writeTaskStatus(root, location, task.id, nextTask);
  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, { ...nextTask, location }, location));
  return {
    task: { ...nextTask, location },
    entry,
    notesPath,
  };
}

export async function markTaskDone(projectRoot, idOrSlug, { locale = getDefaultLocale() } = {}) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }
  const location = task.location || FOLDER_KINDS.active;
  const nextTask = cloneTask(task, { status: 'done' });
  await writeTaskStatus(root, location, task.id, nextTask);
  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, { ...nextTask, location }, location));
  const state = await readProjectState(root);
  if (state?.currentTaskId === task.id) {
    await updateProjectState(root, { currentTaskId: null });
  }
  return { ...nextTask, location };
}

export async function archiveTask(projectRoot, idOrSlug, { locale = getDefaultLocale() } = {}) {
  const root = normalizeRoot(projectRoot);
  const t = await createTranslator(locale);
  const task = await resolveTask(root, idOrSlug);
  if (!task) {
    throw new Error(t('common.taskNotFound', { id: idOrSlug }));
  }

  const sourceLocation = task.location || FOLDER_KINDS.active;
  const sourceFolder = getTaskFolder(root, sourceLocation, task.id);
  const targetFolder = getTaskFolder(root, FOLDER_KINDS.archive, task.id);
  await ensureDirectory(path.dirname(targetFolder));
  if (await fileExists(targetFolder)) {
    await fs.rm(targetFolder, { recursive: true, force: true });
  }
  await fs.rename(sourceFolder, targetFolder);

  const nextTask = cloneTask(task, { status: 'archived' });
  await writeTaskStatus(root, FOLDER_KINDS.archive, task.id, nextTask);
  const index = await readIndex(root);
  await writeIndex(root, upsertIndexRecord(index, { ...nextTask, location: FOLDER_KINDS.archive }, FOLDER_KINDS.archive));

  const state = await readProjectState(root);
  if (state?.currentTaskId === task.id) {
    await updateProjectState(root, { currentTaskId: null });
  }

  return { ...nextTask, location: FOLDER_KINDS.archive };
}

export async function getTaskWorkspaceStatus(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureTaskWorkspace(root);
  const state = await readProjectState(root);
  const index = await readIndex(root);
  const tasks = Array.isArray(index.tasks) ? index.tasks : [];
  return {
    exists: await fileExists(getTasksRoot(root)),
    currentTaskId: state?.currentTaskId || null,
    taskCount: tasks.length,
    activeCount: tasks.filter((task) => task.location !== FOLDER_KINDS.archive).length,
    archivedCount: tasks.filter((task) => task.location === FOLDER_KINDS.archive).length,
    updatedAt: index.updatedAt || null,
  };
}

export function getTaskWorkspaceRoot(projectRoot) {
  return getTasksRoot(projectRoot);
}

export function getTaskFolderLocation(projectRoot, idOrSlug, location = FOLDER_KINDS.active) {
  return getTaskFolder(projectRoot, location, normalizeTaskSelector(idOrSlug));
}

export function getTaskStatusPathLocation(projectRoot, idOrSlug, location = FOLDER_KINDS.active) {
  return getTaskFilePath(projectRoot, location, normalizeTaskSelector(idOrSlug), 'status.json');
}
