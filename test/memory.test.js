import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import {
  ensureProjectMemory,
  getProjectMemoryStatus,
  refreshProjectMemory,
  rebuildProjectMemory,
  showMemoryEntry,
  updateProjectState,
} from '../src/memory.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-project-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'lib'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
    scripts: { dev: 'node src/index.js' },
  }, null, 2));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 42;\n');
  await writeFile(path.join(root, 'lib', 'helper.ts'), 'export const helper = () => true;\n');
  await writeFile(path.join(root, 'README.md'), '# Sample\n');
  return root;
}

function setManualNotes(content, notes) {
  return content.replace(
    /<!-- MANUAL NOTES START -->[\s\S]*?<!-- MANUAL NOTES END -->/m,
    `<!-- MANUAL NOTES START -->\n${notes}\n<!-- MANUAL NOTES END -->`,
  );
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

test('ensureProjectMemory creates the memory workspace structure', async () => {
  const root = await createTempProject();
  const result = await ensureProjectMemory(root);

  await assert.doesNotReject(() => stat(path.join(root, '.local-codex')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'tasks')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'module_summaries')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'prompts')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'policy.json')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'project_overview.md')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'architecture_notes.md')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'decisions_log.md')));
  await assert.doesNotReject(() => stat(path.join(root, '.local-codex', 'state.json')));

  const state = JSON.parse(await readText(path.join(result.statePath)));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.projectRoot, root);
  assert.equal(state.lastRefreshAt, null);
  assert.equal(state.currentTaskId, null);
  assert.ok(state.createdAt);
  assert.ok(state.updatedAt);
});

test('refreshProjectMemory preserves manual notes in generated documents', async () => {
  const root = await createTempProject();
  await ensureProjectMemory(root);
  await refreshProjectMemory(root);

  const overviewPath = path.join(root, '.local-codex', 'project_overview.md');
  const before = await readText(overviewPath);
  const edited = setManualNotes(before, 'Keep this project note.');
  await writeFile(overviewPath, edited);

  await refreshProjectMemory(root);
  const after = await readText(overviewPath);

  assert.match(after, /Keep this project note\./);
  assert.match(after, /<!-- GENERATED START -->/);
  assert.match(after, /<!-- MANUAL NOTES START -->/);
});

test('rebuildProjectMemory safely regenerates module summaries without removing manual notes', async () => {
  const root = await createTempProject();
  await ensureProjectMemory(root);
  await refreshProjectMemory(root);

  const modulePath = path.join(root, '.local-codex', 'module_summaries', 'src.md');
  const before = await readText(modulePath);
  const edited = setManualNotes(before, 'Module-specific note.');
  await writeFile(modulePath, edited);

  await rebuildProjectMemory(root);
  const after = await readText(modulePath);

  assert.match(after, /Module-specific note\./);
  assert.match(after, /<!-- GENERATED START -->/);
  assert.match(after, /Кратко:/);
});

test('updateProjectState persists active role and selected model and refresh updates lastRefreshAt', async () => {
  const root = await createTempProject();
  await ensureProjectMemory(root);

  const before = JSON.parse(await readText(path.join(root, '.local-codex', 'state.json')));
  await updateProjectState(root, {
    activeRole: 'architect',
    selectedModel: 'qwen2.5-coder:14b',
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await refreshProjectMemory(root);

  const after = JSON.parse(await readText(path.join(root, '.local-codex', 'state.json')));

  assert.equal(after.activeRole, 'architect');
  assert.equal(after.selectedModel, 'qwen2.5-coder:14b');
  assert.equal(after.projectRoot, root);
  assert.ok(after.lastRefreshAt);
  assert.ok(after.updatedAt);
  assert.notEqual(after.updatedAt, before.updatedAt);
});

test('showMemoryEntry rejects traversal attempts', async () => {
  const root = await createTempProject();
  await ensureProjectMemory(root);
  await refreshProjectMemory(root);

  await assert.rejects(() => showMemoryEntry(root, '../escape'));
});

test('project status reflects initialized memory', async () => {
  const root = await createTempProject();
  await ensureProjectMemory(root);
  await refreshProjectMemory(root);

  const status = await getProjectMemoryStatus(root);
  assert.equal(status.exists, true);
  assert.ok(status.summaryCount >= 1);
  assert.ok(status.lastRefreshAt);
});
