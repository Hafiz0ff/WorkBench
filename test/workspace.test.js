import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTask, setCurrentTask } from '../src/tasks.js';
import { ensureProjectMemory, updateProjectState } from '../src/memory.js';
import {
  addWorkspace,
  getCurrentWorkspace,
  initGlobal,
  listWorkspaces,
  refreshSnapshot,
  removeWorkspace,
  repairWorkspaces,
  searchWorkspaces,
  switchWorkspace,
} from '../src/workspace.js';

async function createProjectRoot(home, name) {
  const root = path.join(home, 'projects', name);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name,
    type: 'module',
  }, null, 2));
  return root;
}

test('workspace registry add, snapshot, search, switch, and remove work', async () => {
  const previousHome = process.env.WORKBENCH_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-home-'));
  process.env.WORKBENCH_HOME = home;
  try {
    const root = await createProjectRoot(home, 'tasuj');
    await ensureProjectMemory(root);
    await updateProjectState(root, {
      selectedProvider: 'openai',
      selectedModel: 'gpt-4o',
      activeRole: 'backend-engineer',
    });
    const task = await createTask(root, {
      title: 'Auth refactor',
      userRequest: 'Переработать auth flow',
      summary: 'Auth work',
    });
    await setCurrentTask(root, task.id);

    await initGlobal();
    const workspace = await addWorkspace(root, {
      alias: 'tasuj',
      tags: ['trading', 'python'],
      pin: true,
    });

    assert.equal(workspace.alias, 'tasuj');
    assert.equal(workspace.snapshot.provider, 'openai');
    assert.equal(workspace.snapshot.model, 'gpt-4o');
    assert.equal(workspace.snapshot.role, 'backend-engineer');
    assert.equal(workspace.snapshot.activeTask, task.id);
    assert.equal(workspace.snapshot.taskCount, 1);

    const list = await listWorkspaces({ pinned: true });
    assert.equal(list.length, 1);
    assert.equal(list[0].current, true);
    assert.equal(list[0].pinned, true);

    const current = await getCurrentWorkspace();
    assert.equal(current.alias, 'tasuj');

    const search = await searchWorkspaces('trading');
    assert.equal(search.length, 1);
    assert.equal(search[0].alias, 'tasuj');

    const switched = await switchWorkspace('tasuj');
    assert.equal(switched.alias, 'tasuj');

    await fs.rm(root, { recursive: true, force: true });
    const refreshed = await refreshSnapshot('tasuj');
    assert.equal(refreshed.available, false);

    const removed = await removeWorkspace('tasuj');
    assert.equal(removed.alias, 'tasuj');
    assert.equal((await listWorkspaces()).length, 0);
  } finally {
    process.env.WORKBENCH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('workspace registry rejects duplicate aliases and can be repaired from disk', async () => {
  const previousHome = process.env.WORKBENCH_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-home-'));
  process.env.WORKBENCH_HOME = home;
  try {
    const alpha = await createProjectRoot(home, 'alpha');
    const beta = await createProjectRoot(home, 'beta');
    await ensureProjectMemory(alpha);
    await ensureProjectMemory(beta);
    await initGlobal();
    await addWorkspace(alpha, { alias: 'shared' });
    await assert.rejects(() => addWorkspace(beta, { alias: 'shared' }), /alias already exists/i);

    const repaired = await repairWorkspaces();
    assert.equal(repaired.length, 2);
    const aliases = repaired.map((workspace) => workspace.alias).sort();
    assert.deepEqual(aliases, ['alpha', 'beta']);
  } finally {
    process.env.WORKBENCH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});
