import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import {
  ensureTaskWorkspace,
  createTask,
  setCurrentTask,
  getCurrentTask,
  generateTaskPlan,
  appendTaskNote,
  markTaskDone,
  archiveTask,
  showTask,
  resolveTask,
} from '../src/tasks.js';
import { readProjectState } from '../src/memory.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-tasks-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'lib'), { recursive: true });
  return root;
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

test('task creation scaffolds a task folder and metadata', async () => {
  const root = await createTempProject();
  await ensureTaskWorkspace(root);

  const task = await createTask(root, {
    title: 'Auth refactor',
    userRequest: 'Переработать вход пользователя',
    relevantFiles: ['src/index.js'],
  });

  await assert.doesNotReject(() => stat(task.folderPath));
  await assert.doesNotReject(() => stat(path.join(task.folderPath, 'task.md')));
  await assert.doesNotReject(() => stat(path.join(task.folderPath, 'plan.md')));
  await assert.doesNotReject(() => stat(path.join(task.folderPath, 'notes.md')));
  await assert.doesNotReject(() => stat(path.join(task.folderPath, 'artifacts.md')));
  await assert.doesNotReject(() => stat(path.join(task.folderPath, 'status.json')));

  const status = JSON.parse(await readText(path.join(task.folderPath, 'status.json')));
  assert.equal(status.id, task.id);
  assert.equal(status.status, 'draft');
  assert.equal(status.slug, 'auth-refactor');
  assert.deepEqual(status.relevantFiles, ['src/index.js']);
});

test('task switching persists current task in project state', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Auth refactor',
    userRequest: 'Переработать вход пользователя',
  });

  const current = await setCurrentTask(root, task.id);
  const state = await readProjectState(root);
  const loaded = await getCurrentTask(root);

  assert.equal(current.status, 'in_progress');
  assert.equal(state.currentTaskId, task.id);
  assert.equal(loaded.id, task.id);
});

test('task plan generation writes a concise editable plan', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Dashboard polish',
    userRequest: 'Улучшить читаемость панели',
    relevantFiles: ['src/ui/dashboard.tsx'],
  });

  const result = await generateTaskPlan(root, task.id, { context: 'Корневой контекст проекта.' });
  const plan = await readText(result.planPath);

  assert.match(plan, /Корневой контекст проекта\./);
  assert.match(plan, /Проверка/);
  assert.match(plan, /src\/ui\/dashboard\.tsx/);
});

test('task notes append structured entries and update lastRunNotes', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Notes flow',
    userRequest: 'Проверить заметки',
  });

  const result = await appendTaskNote(root, task.id, {
    kind: 'finding',
    source: 'agent',
    text: 'Проверка успешна.',
  });

  const notes = await readText(path.join(task.folderPath, 'notes.md'));
  assert.match(notes, /Проверка успешна\./);
  assert.equal(result.task.lastRunNotes[0].kind, 'finding');
  assert.equal(result.task.lastRunNotes[0].source, 'agent');
});

test('task done and archive transitions update state and move folders', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Archive flow',
    userRequest: 'Проверить архивирование',
  });

  await setCurrentTask(root, task.id);
  const done = await markTaskDone(root, task.id);
  const stateAfterDone = await readProjectState(root);
  assert.equal(done.status, 'done');
  assert.equal(stateAfterDone.currentTaskId, null);

  const archived = await archiveTask(root, task.id);
  const archivePath = path.join(root, '.local-codex', 'tasks', 'archive', task.id);
  await assert.doesNotReject(() => stat(archivePath));
  assert.equal(archived.status, 'archived');

  const resolved = await resolveTask(root, task.id);
  assert.equal(resolved.location, 'archive');
});

test('task commands reject path traversal attempts', async () => {
  const root = await createTempProject();
  await createTask(root, { title: 'Safety check', userRequest: 'Проверить безопасность путей' });

  await assert.rejects(() => showTask(root, '../escape'));
  await assert.rejects(() => setCurrentTask(root, '../escape'));
});
