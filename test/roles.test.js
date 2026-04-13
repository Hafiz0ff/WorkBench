import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  scaffoldBuiltInRoles,
  loadRoleProfile,
  setActiveRole,
  getCurrentRoleSelection,
  resolveRoleSelection,
} from '../src/roles.js';
import { readProjectState } from '../src/memory.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-roles-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  return root;
}

test('scaffolds built-in role profiles', async () => {
  const root = await createTempProject();
  await scaffoldBuiltInRoles(root);

  const rolesRoot = path.join(root, '.local-codex', 'prompts', 'roles');
  const files = [
    'senior-engineer.md',
    'software-architect.md',
    'code-reviewer.md',
    'debugging-expert.md',
    'designer.md',
    'product-manager.md',
  ];

  for (const file of files) {
    await assert.doesNotReject(() => readFile(path.join(rolesRoot, file), 'utf8'));
  }
});

test('loads and parses role files', async () => {
  const root = await createTempProject();
  await scaffoldBuiltInRoles(root);

  const profile = await loadRoleProfile(root, 'software-architect');
  assert.equal(profile.name, 'software-architect');
  assert.match(profile.description, /границ|интерфейс|миграц/i);
  assert.ok(profile.goals.length >= 2);
  assert.ok(profile.behavioralRules.length >= 1);
  assert.ok(profile.toolUsageGuidance.length >= 1);
  assert.ok(profile.outputStyle.length >= 1);
});

test('persists the active role in state.json', async () => {
  const root = await createTempProject();
  await scaffoldBuiltInRoles(root);

  const profile = await setActiveRole(root, 'code-reviewer');
  assert.equal(profile.name, 'code-reviewer');

  const state = await readProjectState(root);
  assert.equal(state.activeRole, 'code-reviewer');

  const current = await getCurrentRoleSelection(root);
  assert.equal(current.name, 'code-reviewer');
});

test('falls back to the default role when a requested role is missing', async () => {
  const root = await createTempProject();
  await scaffoldBuiltInRoles(root);

  const resolved = await resolveRoleSelection(root, 'does-not-exist');
  assert.equal(resolved.name, 'senior-engineer');
  assert.equal(resolved.fallback, true);
  assert.equal(resolved.requestedRole, 'does-not-exist');
});

test('falls back to the built-in template when a built-in role file is invalid', async () => {
  const root = await createTempProject();
  await scaffoldBuiltInRoles(root);

  const filePath = path.join(root, '.local-codex', 'prompts', 'roles', 'debugging-expert.md');
  await writeFile(filePath, 'not frontmatter at all\n');

  const profile = await loadRoleProfile(root, 'debugging-expert');
  assert.equal(profile.name, 'debugging-expert');
  assert.equal(profile.fallback, true);
  assert.match(profile.parseError, /frontmatter|Недопуст/i);
});
