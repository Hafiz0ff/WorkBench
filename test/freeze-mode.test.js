import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { scaffoldBuiltInRoles, resolveRoleSelection } from '../src/roles.js';
import { getDefaultPolicy, readProjectPolicy } from '../src/policy.js';
import { stageProjectFileChange } from '../src/patches.js';
import { composePromptLayers, BASE_SYSTEM_INSTRUCTIONS } from '../src/prompt-composer.js';
import { getFreezeModeAuditInstruction, getFreezeModeInstruction, readProjectFreezeMode, setProjectFreezeMode } from '../src/freeze-mode.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-freeze-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await scaffoldBuiltInRoles(root);
  return root;
}

test('freeze mode stores state, blocks patch staging and injects read-only instructions', async () => {
  const root = await createTempProject();

  const result = await setProjectFreezeMode(root, true, { reason: 'release candidate' });
  assert.equal(result.freezeMode.enabled, true);
  assert.equal(result.freezeMode.reason, 'release candidate');

  const state = await readProjectFreezeMode(root);
  assert.equal(state.enabled, true);
  assert.equal(state.reason, 'release candidate');

  const policy = await readProjectPolicy(root);
  assert.equal(policy.freezeMode.enabled, true);

  await assert.rejects(
    () => stageProjectFileChange(root, 'src/index.js', 'export const value = 2;\n', { policy }),
    /Freeze mode is active/i,
  );

  const roleProfile = await resolveRoleSelection(root, 'senior-engineer');
  const composition = await composePromptLayers({
    baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
    roleProfile,
    memorySummary: 'Memory snapshot',
    taskContext: 'Task context',
    conversationSummary: 'Conversation summary',
    extensionPrompts: [],
    taskInstruction: 'Inspect the codebase.',
    allowedShellCommands: ['git status'],
    projectRoot: root,
    policy,
  });

  assert.ok(composition.finalPrompt.includes(getFreezeModeInstruction()));
  assert.ok(composition.finalPrompt.includes(getFreezeModeAuditInstruction()));
});
