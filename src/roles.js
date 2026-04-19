import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureProjectMemory, readProjectState, updateProjectState } from './memory.js';
import { getBuiltinRoleTemplate, getBuiltinRoleTemplates, getBuiltinRoleNames } from './role-templates.js';
import { listEnabledExtensionRoleProfiles } from './extensions.js';
import { trackEvent } from './stats.js';

const ROLE_DIR_NAME = path.join('.local-codex', 'prompts', 'roles');
const ROLE_ALIASES = new Map([
  ['senior-developer', 'senior-engineer'],
  ['architect', 'software-architect'],
  ['reviewer', 'code-reviewer'],
]);

function normalizeRoleName(name) {
  if (typeof name !== 'string') {
    throw new Error('Не указано имя роли.');
  }
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Не указано имя роли.');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw new Error(`Недопустимое имя роли: ${name}`);
  }
  return trimmed;
}

function resolveRoleName(name) {
  const normalized = normalizeRoleName(name);
  return ROLE_ALIASES.get(normalized) || normalized;
}

function getRolesRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), ROLE_DIR_NAME);
}

function getRoleFilePath(projectRoot, roleName) {
  return path.join(getRolesRoot(projectRoot), `${resolveRoleName(roleName)}.md`);
}

function toFrontmatterArray(values) {
  return values.map((value) => `  - ${value}`).join('\n');
}

function renderRoleFile(template) {
  return [
    '---',
    `name: ${template.name}`,
    `description: ${template.description}`,
    'goals:',
    toFrontmatterArray(template.goals),
    'behavioral_rules:',
    toFrontmatterArray(template.behavioral_rules),
    'tool_usage_guidance:',
    toFrontmatterArray(template.tool_usage_guidance),
    'output_style:',
    toFrontmatterArray(template.output_style),
    'do:',
    toFrontmatterArray(template.do),
    'dont:',
    toFrontmatterArray(template.dont),
    '---',
    '',
    `# ${template.name}`,
    '',
    template.description,
    '',
    'Этот профиль роли хранится в файловой системе и может редактироваться вручную.',
    '',
  ].join('\n');
}

function renderRoleSummary(profile) {
  const sections = [
    `Имя: ${profile.name}`,
    `Описание: ${profile.description}`,
    '',
    'Цели:',
    ...profile.goals.map((item) => `- ${item}`),
    '',
    'Поведенческие правила:',
    ...profile.behavioralRules.map((item) => `- ${item}`),
    '',
    'Рекомендации по инструментам:',
    ...profile.toolUsageGuidance.map((item) => `- ${item}`),
    '',
    'Стиль ответа:',
    ...profile.outputStyle.map((item) => `- ${item}`),
    '',
    'Делай:',
    ...profile.do.map((item) => `- ${item}`),
    '',
    'Не делай:',
    ...profile.dont.map((item) => `- ${item}`),
  ];
  return sections.join('\n');
}

function validateRoleProfile(profile, filePath) {
  const requiredArrayFields = ['goals', 'behavioral_rules', 'tool_usage_guidance', 'output_style', 'do', 'dont'];
  if (!profile || typeof profile !== 'object') {
    throw new Error(`Недопустимый профиль роли в ${filePath}`);
  }
  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new Error(`Недопустимое имя профиля роли в ${filePath}`);
  }
  if (typeof profile.description !== 'string' || !profile.description.trim()) {
    throw new Error(`Недопустимое описание профиля роли в ${filePath}`);
  }
  for (const field of requiredArrayFields) {
    if (!Array.isArray(profile[field]) || profile[field].some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`Недопустимое поле профиля роли "${field}" в ${filePath}`);
    }
  }
}

function parseFrontmatterList(lines, startIndex) {
  const values = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z0-9_]+:\s*/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.*)$/);
    if (!match) {
      break;
    }
    values.push(match[1].trim());
    index += 1;
  }
  return { values, nextIndex: index };
}

function parseRoleFrontmatter(source, filePath) {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) {
    throw new Error(`Отсутствует frontmatter в ${filePath}`);
  }
  const lines = trimmed.split(/\r?\n/);
  let index = 1;
  const profile = {};

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '---') {
      validateRoleProfile(profile, filePath);
      return profile;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Недопустимая строка frontmatter в ${filePath}: ${line}`);
    }
    const key = match[1];
    const value = match[2];
    if (value.trim()) {
      profile[key] = value.trim();
      index += 1;
      continue;
    }
    const parsedList = parseFrontmatterList(lines, index + 1);
    profile[key] = parsedList.values;
    index = parsedList.nextIndex;
  }

  throw new Error(`Незакрытый frontmatter в ${filePath}`);
}

function normalizeParsedProfile(profile, filePath) {
  validateRoleProfile(profile, filePath);
  return {
    name: profile.name.trim(),
    description: profile.description.trim(),
    goals: profile.goals.map((item) => item.trim()),
    behavioralRules: profile.behavioral_rules.map((item) => item.trim()),
    toolUsageGuidance: profile.tool_usage_guidance.map((item) => item.trim()),
    outputStyle: profile.output_style.map((item) => item.trim()),
    do: profile.do.map((item) => item.trim()),
    dont: profile.dont.map((item) => item.trim()),
  };
}

function profileFromTemplate(template, filePath, extra = {}) {
  return {
    name: template.name,
    description: template.description,
    goals: [...template.goals],
    behavioralRules: [...template.behavioral_rules],
    toolUsageGuidance: [...template.tool_usage_guidance],
    outputStyle: [...template.output_style],
    do: [...template.do],
    dont: [...template.dont],
    filePath,
    builtin: true,
    ...extra,
  };
}

function profileFromParsed(parsed, filePath, extra = {}) {
  return {
    ...parsed,
    filePath,
    builtin: false,
    ...extra,
  };
}

function getRoleDisplayName(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(filePath, content) {
  if (await fileExists(filePath)) {
    return false;
  }
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

function createCustomRoleTemplate(name) {
  const displayName = getRoleDisplayName(name);
  return {
    name,
    description: `Профиль роли ${displayName}. Замените это описание на целевой сценарий использования.`,
    goals: [
      'Четко определить цели роли.',
      'Сделать поведение практичным и применимым в реальной работе.',
      'Заменить этот шаблон на рекомендации, специфичные для проекта.',
    ],
    behavioral_rules: [
      'Описать ожидаемый стиль принятия решений для этой роли.',
      'Пояснить, как эта роль должна рассуждать о коде или продуктовой работе.',
      'Держать правила достаточно короткими, чтобы ими можно было пользоваться в реальных задачах.',
    ],
    tool_usage_guidance: [
      'Перечислить инструменты, которые эта роль должна предпочитать.',
      'Указать, когда нужно смотреть файлы перед редактированием.',
      'Описать команды, которые стоит использовать осторожно.',
    ],
    output_style: [
      'Описать желаемый формат ответа для этой роли.',
      'Сохранить стиль ответа последовательным для типа задачи.',
    ],
    do: [
      'Замените заглушки на явное поведение.',
      'Сохраняйте итоговый файл удобным для ручного редактирования.',
    ],
    dont: [
      'Не оставляйте шаблон слишком расплывчатым.',
      'Не удаляйте структуру frontmatter.',
    ],
  };
}

export async function scaffoldBuiltInRoles(projectRoot) {
  const root = path.resolve(projectRoot);
  await ensureProjectMemory(root);
  const rolesRoot = getRolesRoot(root);
  await ensureDirectory(rolesRoot);

  const templates = getBuiltinRoleTemplates();
  for (const template of templates) {
    await writeIfMissing(path.join(rolesRoot, `${template.name}.md`), renderRoleFile(template));
  }

  return rolesRoot;
}

async function readRoleProfileFromFile(filePath, fallbackTemplate = null) {
  const content = await fs.readFile(filePath, 'utf8');
  try {
    const parsed = parseRoleFrontmatter(content, filePath);
    return profileFromParsed(normalizeParsedProfile(parsed, filePath), filePath);
  } catch (error) {
    if (fallbackTemplate) {
      return profileFromTemplate(fallbackTemplate, filePath, {
        fallback: true,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export async function loadRoleProfile(projectRoot, roleName) {
  const root = path.resolve(projectRoot);
  const canonicalName = resolveRoleName(roleName);
  const rolesRoot = await scaffoldBuiltInRoles(root);
  const filePath = path.join(rolesRoot, `${canonicalName}.md`);
  const builtinTemplate = getBuiltinRoleTemplate(canonicalName);

  if (!(await fileExists(filePath))) {
    if (builtinTemplate) {
      return profileFromTemplate(builtinTemplate, filePath, { fallback: true, missing: true });
    }
    throw new Error(`Role profile not found: ${canonicalName}`);
  }

  try {
    return await readRoleProfileFromFile(filePath, builtinTemplate);
  } catch (error) {
    if (builtinTemplate) {
      return profileFromTemplate(builtinTemplate, filePath, {
        fallback: true,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
    const extensionProfiles = await listEnabledExtensionRoleProfiles(root);
    const extensionProfile = extensionProfiles.find((profile) => profile.name === canonicalName);
    if (extensionProfile) {
      return {
        name: extensionProfile.name,
        description: extensionProfile.description,
        goals: [...(extensionProfile.goals || [])],
        behavioralRules: [...(extensionProfile.behavioralRules || [])],
        toolUsageGuidance: [...(extensionProfile.toolUsageGuidance || [])],
        outputStyle: [...(extensionProfile.outputStyle || [])],
        do: [...(extensionProfile.do || [])],
        dont: [...(extensionProfile.dont || [])],
        filePath: extensionProfile.filePath,
        builtin: false,
        sourceExtensionId: extensionProfile.sourceExtensionId,
      };
    }
    throw error;
  }
}

async function readRoleProfilesFromDirectory(rolesRoot) {
  const entries = await fs.readdir(rolesRoot, { withFileTypes: true }).catch(() => []);
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const roleName = entry.name.replace(/\.md$/, '');
    const builtinTemplate = getBuiltinRoleTemplate(roleName);
    const filePath = path.join(rolesRoot, entry.name);
    try {
      const profile = await readRoleProfileFromFile(filePath, builtinTemplate);
      profiles.push(profile);
    } catch (error) {
      if (builtinTemplate) {
        profiles.push(profileFromTemplate(builtinTemplate, filePath, {
          fallback: true,
          parseError: error instanceof Error ? error.message : String(error),
        }));
        continue;
      }
      profiles.push({
        name: roleName,
        description: '[invalid role file]',
        goals: [],
        behavioralRules: [],
        toolUsageGuidance: [],
        outputStyle: [],
        do: [],
        dont: [],
        filePath,
        builtin: false,
        invalid: true,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return profiles;
}

export async function listRoleProfiles(projectRoot) {
  const root = path.resolve(projectRoot);
  const rolesRoot = await scaffoldBuiltInRoles(root);
  const profiles = await readRoleProfilesFromDirectory(rolesRoot);
  const extensionProfiles = await listEnabledExtensionRoleProfiles(root);
  profiles.push(...extensionProfiles.map((profile) => ({
    name: profile.name,
    description: profile.description,
    goals: [...(profile.goals || [])],
    behavioralRules: [...(profile.behavioralRules || [])],
    toolUsageGuidance: [...(profile.toolUsageGuidance || [])],
    outputStyle: [...(profile.outputStyle || [])],
    do: [...(profile.do || [])],
    dont: [...(profile.dont || [])],
    filePath: profile.filePath,
    builtin: false,
    sourceExtensionId: profile.sourceExtensionId,
  })));
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return profiles;
}

export async function getCurrentRoleSelection(projectRoot) {
  const root = path.resolve(projectRoot);
  const state = await readProjectState(root);
  if (!state?.activeRole) {
    return null;
  }
  return resolveRoleSelection(root, state.activeRole);
}

export async function setActiveRole(projectRoot, roleName) {
  const root = path.resolve(projectRoot);
  const profile = await loadRoleProfile(root, roleName);
  await updateProjectState(root, {
    activeRole: profile.name,
  });
  void trackEvent(root, {
    type: 'role.used',
    role: profile.name,
    filePath: profile.filePath,
  });
  return profile;
}

export async function createRoleProfile(projectRoot, roleName) {
  const root = path.resolve(projectRoot);
  await scaffoldBuiltInRoles(root);
  const canonicalName = normalizeRoleName(roleName);
  if (getBuiltinRoleTemplate(canonicalName)) {
    throw new Error(`Role already exists as a built-in profile: ${canonicalName}`);
  }
  const rolesRoot = getRolesRoot(root);
  await ensureDirectory(rolesRoot);
  const filePath = path.join(rolesRoot, `${canonicalName}.md`);
  if (await fileExists(filePath)) {
    throw new Error(`Role already exists: ${canonicalName}`);
  }
  const template = createCustomRoleTemplate(canonicalName);
  await fs.writeFile(filePath, renderRoleFile(template), 'utf8');
  return profileFromTemplate(template, filePath, { builtin: false, created: true });
}

export async function resolveRoleSelection(projectRoot, preferredRoleName = null) {
  const root = path.resolve(projectRoot);
  const state = await readProjectState(root);
  const requested = preferredRoleName || state?.activeRole || 'senior-engineer';
  try {
    return await loadRoleProfile(root, requested);
  } catch (error) {
    const fallback = await loadRoleProfile(root, 'senior-engineer');
    return {
      ...fallback,
      fallback: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
      requestedRole: requested,
    };
  }
}

export async function autoDetectRole(projectRoot, taskText = '') {
  const root = path.resolve(projectRoot);
  const source = String(taskText || '').trim().toLowerCase();
  if (!source) {
    return 'senior-engineer';
  }

  const profiles = await listRoleProfiles(root).catch(() => []);
  const available = new Set(profiles.map((profile) => profile.name));
  const keywords = [
    ['frontend-engineer', ['ui', 'ux', 'frontend', 'layout', 'css', 'html', 'react', 'vue', 'компонент', 'интерфейс', 'экран', 'верстк', 'дизайн']],
    ['backend-engineer', ['backend', 'api', 'server', 'database', 'db', 'sql', 'orm', 'route', 'endpoint', 'сервер', 'база', 'данн', 'контракт']],
    ['test-engineer', ['test', 'spec', 'coverage', 'assert', 'integration test', 'unit test', 'тест', 'покрыти', 'регресси']],
    ['performance-optimizer', ['performance', 'latency', 'memory leak', 'optimize', 'slow', 'bottleneck', 'производител', 'медлен', 'оптимиз']],
    ['refactoring-strategist', ['refactor', 'cleanup', 'simplify', 'restructure', 'рефактор', 'упрост', 'перестро', 'cleanup']],
    ['release-engineer', ['release', 'deploy', 'ship', 'version', 'changelog', 'tag', 'релиз', 'деплой', 'верси', 'нотари']],
    ['api-designer', ['api design', 'api contract', 'rest', 'graphql', 'schema', 'openapi', 'контракт api', 'дизайн api']],
    ['migration-engineer', ['migration', 'migrate', 'schema change', 'upgrade path', 'rollback', 'миграц', 'перенос формата']],
    ['qa-analyst', ['qa', 'acceptance', 'checklist', 'scenario', 'manual test', 'приемк', 'сценари', 'чеклист']],
    ['bug-hunter', ['bug', 'fix', 'broken', 'issue', 'regression', 'ошибк', 'баг', 'сломано', 'не работает']],
    ['devops-engineer', ['devops', 'infra', 'docker', 'ci', 'cd', 'pipeline', 'kubernetes', 'terraform', 'инфра', 'сборк']],
    ['security-reviewer', ['security', 'auth', 'permission', 'secret', 'token', 'xss', 'csrf', 'sql injection', 'безопас', 'секрет', 'доступ']],
    ['documentation-engineer', ['docs', 'readme', 'documentation', 'guide', 'manual', 'документац', 'readme', 'инструкц']],
    ['integration-engineer', ['integration', 'webhook', 'adapter', 'bridge', 'sync', 'mcp', 'интеграц', 'адаптер', 'хук']],
    ['software-architect', ['architecture', 'architect', 'system design', 'boundary', 'module', 'архитект', 'границ', 'модул']],
    ['code-reviewer', ['review', 'audit', 'code review', 'pr review', 'ревью', 'аудит кода', 'review comments']],
    ['debugging-expert', ['debug', 'trace', 'investigate', 'stack trace', 'reproduce', 'отлад', 'диагност', 'воспроизвед']],
    ['designer', ['design system', 'visual', 'brand', 'mockup', 'glassmorphism', 'визуал', 'типограф', 'стиль']],
    ['product-manager', ['product', 'roadmap', 'scope', 'requirement', 'ux flow', 'продукт', 'roadmap', 'тз', 'сценарий']],
  ];

  let bestRole = 'senior-engineer';
  let bestScore = 0;
  for (const [roleName, roleKeywords] of keywords) {
    if (!available.has(roleName)) {
      continue;
    }
    let score = 0;
    for (const keyword of roleKeywords) {
      if (source.includes(keyword)) {
        score += keyword.includes(' ') ? 3 : 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = roleName;
    }
  }

  return bestRole;
}

export function formatRoleProfile(profile) {
  return renderRoleSummary(profile);
}

export function getRoleFileLocation(projectRoot, roleName) {
  return getRoleFilePath(projectRoot, roleName);
}

export function getRoleNameAliasCandidates() {
  return [...ROLE_ALIASES.entries()].map(([from, to]) => `${from} -> ${to}`);
}

export function getBuiltinRoleNamesList() {
  return getBuiltinRoleNames();
}

export function getResolvedRoleName(roleName) {
  return resolveRoleName(roleName);
}

export function getRoleDisplayLabel(roleName) {
  return getRoleDisplayName(roleName);
}
