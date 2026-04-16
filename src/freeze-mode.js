import { normalizeRoot } from './security.js';
import { ensureProjectMemory, readProjectState, updateProjectState } from './memory.js';
import { ensureProjectPolicy, readProjectPolicy, writeProjectPolicy } from './policy.js';

const FREEZE_MODE_INSTRUCTION = 'Отныне: режим ТОЛЬКО ЧТЕНИЕ. Анализируй код, давай советы по дебаггингу, но не генерируй никаких изменяющих патчей';
const FREEZE_MODE_AUDIT_INSTRUCTION = 'Фокус: ищи логические ошибки, нарушения инвариантов, неучтенные edge cases и блокеры компиляции. Не предлагай и не применяй исправления.';

function nowIso() {
  return new Date().toISOString();
}

function normalizeFreezeRecord(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled === true,
    activatedAt: typeof source.activatedAt === 'string' && source.activatedAt.trim()
      ? source.activatedAt.trim()
      : null,
    deactivatedAt: typeof source.deactivatedAt === 'string' && source.deactivatedAt.trim()
      ? source.deactivatedAt.trim()
      : null,
    reason: typeof source.reason === 'string' ? source.reason.trim() : '',
    instruction: typeof source.instruction === 'string' && source.instruction.trim()
      ? source.instruction.trim()
      : FREEZE_MODE_INSTRUCTION,
  };
}

export function getFreezeModeInstruction() {
  return FREEZE_MODE_INSTRUCTION;
}

export function getFreezeModeAuditInstruction() {
  return FREEZE_MODE_AUDIT_INSTRUCTION;
}

export function isFreezeModeEnabled(source) {
  return Boolean(source?.freezeMode?.enabled || source?.enabled === true);
}

export async function readProjectFreezeMode(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const state = await readProjectState(root).catch(() => null);
  return normalizeFreezeRecord(state?.freezeMode || {});
}

export async function setProjectFreezeMode(projectRoot, enabled, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensureProjectMemory(root);
  await ensureProjectPolicy(root);

  const [state, policy] = await Promise.all([
    readProjectState(root).catch(() => null),
    readProjectPolicy(root).catch(() => null),
  ]);
  const timestamp = nowIso();
  const currentFreezeMode = normalizeFreezeRecord(state?.freezeMode || policy?.freezeMode || {});
  const nextFreezeMode = {
    ...currentFreezeMode,
    enabled: Boolean(enabled),
    instruction: FREEZE_MODE_INSTRUCTION,
    reason: typeof options.reason === 'string' ? options.reason.trim() : currentFreezeMode.reason,
    activatedAt: enabled
      ? timestamp
      : currentFreezeMode.activatedAt,
    deactivatedAt: enabled
      ? null
      : timestamp,
  };

  await updateProjectState(root, {
    freezeMode: nextFreezeMode,
  });

  const nextPolicy = {
    ...(policy || {}),
    freezeMode: {
      ...(policy?.freezeMode || {}),
      ...nextFreezeMode,
    },
  };
  await writeProjectPolicy(root, nextPolicy);

  return {
    freezeMode: nextFreezeMode,
    policy: nextPolicy,
    state: await readProjectState(root).catch(() => null),
  };
}
