import { ensureProjectMemory } from './memory.js';
import { ensureTaskWorkspace } from './tasks.js';
import { ensureProjectPolicy } from './policy.js';
import { ensureExtensionsWorkspace } from './extensions.js';
import { ensureRegistryWorkspace } from './registry.js';
import { ensureProvidersWorkspace } from './providers/index.js';
import { scaffoldBuiltInRoles } from './roles.js';
import { initGlobal as initGlobalWorkspace } from './workspace.js';
import { initHooks } from './hooks.js';

export async function prepareProjectWorkspace(root, { scaffoldRoles = false } = {}) {
  await initGlobalWorkspace();
  if (scaffoldRoles) {
    await scaffoldBuiltInRoles(root);
  }
  const { memoryRoot } = await ensureProjectMemory(root);
  await ensureTaskWorkspace(root);
  await ensureProjectPolicy(root);
  await ensureProvidersWorkspace(root);
  await ensureExtensionsWorkspace(root);
  await ensureRegistryWorkspace(root);
  await initHooks(root);
  return { memoryRoot };
}
