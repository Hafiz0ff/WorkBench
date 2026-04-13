import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { ensureProjectPolicy, readProjectPolicy } from './policy.js';

const MEMORY_DIR_NAME = '.local-codex';
const MEMORY_SCHEMA_VERSION = 1;
const GENERATED_START = '<!-- GENERATED START -->';
const GENERATED_END = '<!-- GENERATED END -->';
const MANUAL_START = '<!-- MANUAL NOTES START -->';
const MANUAL_END = '<!-- MANUAL NOTES END -->';
const DEFAULT_MANUAL_PLACEHOLDER = '<!-- Добавьте ручные заметки здесь. -->';
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'out',
  'tmp',
  'temp',
  '.cache',
  '.idea',
  '.vscode',
  'assets',
  'public',
  'static',
  'media',
  'images',
  'img',
  'icons',
  'fonts',
]);
const IGNORED_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.tif',
  '.tiff',
  '.mp4',
  '.mov',
  '.mp3',
  '.wav',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]);
const SOURCE_ROOT_CANDIDATES = ['src', 'app', 'lib', 'server', 'client', 'components', 'packages'];
const BUILTIN_MEMORY_FILES = {
  project_overview: 'project_overview.md',
  architecture_notes: 'architecture_notes.md',
  decisions_log: 'decisions_log.md',
};

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.writeFile(tempPath, content, encoding).then(() => fs.rename(tempPath, filePath));
}

function isIgnoredDirectory(name) {
  if (IGNORED_DIRECTORY_NAMES.has(name)) {
    return true;
  }
  return name.startsWith('.') && !['.local-codex'].includes(name);
}

function isIgnoredFile(name) {
  const ext = path.extname(name).toLowerCase();
  return IGNORED_FILE_EXTENSIONS.has(ext);
}

function isSourceFile(name) {
  const ext = path.extname(name).toLowerCase();
  return [
    '.js',
    '.cjs',
    '.mjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.json',
    '.yml',
    '.yaml',
    '.toml',
    '.css',
    '.scss',
    '.less',
    '.html',
    '.sh',
    '.swift',
    '.go',
    '.rs',
    '.py',
    '.java',
    '.kt',
  ].includes(ext);
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC' : 'не задано';
}

function safeCount(value) {
  return Number.isFinite(value) ? value : 0;
}

function extractBlock(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  const block = content.slice(start + startMarker.length, end).trim();
  return block;
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
  const normalizedGenerated = generated.trim();
  const normalizedManual = manual.trim() || DEFAULT_MANUAL_PLACEHOLDER;
  return [
    `# ${title}`,
    '',
    GENERATED_START,
    normalizedGenerated,
    GENERATED_END,
    '',
    MANUAL_START,
    normalizedManual,
    MANUAL_END,
    '',
  ].join('\n');
}

async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJsonFile(filePath) {
  try {
    const content = await readTextFile(filePath);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getMemoryRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), MEMORY_DIR_NAME);
}

function resolveMemoryPath(projectRoot, relativePath) {
  return resolveWithinRoot(getMemoryRoot(projectRoot), relativePath);
}

function normalizeMemoryName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Не указано имя записи памяти.');
  }
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    throw new Error(`Недопустимое имя записи памяти: ${name}`);
  }
  return trimmed.replace(/^\/+/, '');
}

async function ensureDirectory(filePath) {
  await fs.mkdir(filePath, { recursive: true });
}

async function initializeMemoryDocument(filePath, title) {
  if (await fileExists(filePath)) {
    return;
  }
  const content = renderSectionedDocument({
    title,
    generated: 'Сгенерированного содержимого пока нет. Запустите `app project refresh`, чтобы заполнить этот файл.',
    manualNotes: DEFAULT_MANUAL_PLACEHOLDER,
  });
  await atomicWriteFile(filePath, content);
}

export async function ensureProjectMemory(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const memoryRoot = getMemoryRoot(root);
  await ensureDirectory(memoryRoot);
  await ensureProjectPolicy(root);
  await ensureDirectory(path.join(memoryRoot, 'tasks'));
  await ensureDirectory(path.join(memoryRoot, 'tasks', 'active'));
  await ensureDirectory(path.join(memoryRoot, 'tasks', 'archive'));
  await ensureDirectory(path.join(memoryRoot, 'tasks', 'templates'));
  await ensureDirectory(path.join(memoryRoot, 'patches'));
  await ensureDirectory(path.join(memoryRoot, 'module_summaries'));
  await ensureDirectory(path.join(memoryRoot, 'prompts'));

  await initializeMemoryDocument(path.join(memoryRoot, BUILTIN_MEMORY_FILES.project_overview), 'Обзор проекта');
  await initializeMemoryDocument(path.join(memoryRoot, BUILTIN_MEMORY_FILES.architecture_notes), 'Архитектурные заметки');
  await initializeMemoryDocument(path.join(memoryRoot, BUILTIN_MEMORY_FILES.decisions_log), 'Журнал решений');

  const statePath = path.join(memoryRoot, 'state.json');
  if (!(await fileExists(statePath))) {
    const timestamp = nowIso();
    const state = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRefreshAt: null,
      selectedProvider: 'ollama',
      activeRole: null,
      selectedModel: null,
      currentTaskId: null,
      projectRoot: root,
    };
    await atomicWriteFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  return {
    memoryRoot,
    statePath,
  };
}

export async function readProjectState(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const memoryRoot = getMemoryRoot(root);
  const statePath = path.join(memoryRoot, 'state.json');
  const state = await readJsonFile(statePath);
  if (!state) {
    return null;
  }
  return state;
}

export async function updateProjectState(projectRoot, patch) {
  const root = normalizeRoot(projectRoot);
  await ensureProjectMemory(root);
  const memoryRoot = getMemoryRoot(root);
  const statePath = path.join(memoryRoot, 'state.json');
  const existing = (await readJsonFile(statePath)) || {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    createdAt: nowIso(),
    lastRefreshAt: null,
    selectedProvider: 'ollama',
    activeRole: null,
    selectedModel: null,
    currentTaskId: null,
    projectRoot: root,
  };
  const timestamp = nowIso();
  const next = {
    ...existing,
    ...patch,
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: timestamp,
    projectRoot: root,
    createdAt: existing.createdAt || timestamp,
    currentTaskId: Object.prototype.hasOwnProperty.call(patch, 'currentTaskId')
      ? patch.currentTaskId
      : (existing.currentTaskId ?? null),
  };
  await atomicWriteFile(statePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function readdirSafe(dirPath) {
  return fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
}

async function listMarkdownFilesRecursive(directory, prefix = '') {
  const entries = await readdirSafe(directory);
  const results = [];
  for (const entry of entries) {
    const relativeName = prefix ? path.join(prefix, entry.name) : entry.name;
    const absoluteName = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listMarkdownFilesRecursive(absoluteName, relativeName)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relativeName.replace(/\.md$/, ''));
    }
  }
  return results;
}

async function pathStats(relativePath, root) {
  const absolutePath = path.join(root, relativePath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  return { absolutePath, stat };
}

async function scanDirectorySummary(root, relativePath, maxDepth = 2) {
  const absolutePath = path.join(root, relativePath);
  const entries = [];
  let fileCount = 0;
  let dirCount = 0;
  const extensionCounts = new Map();
  const keyFiles = [];

  async function walk(currentAbsolutePath, currentRelativePath, depth) {
    if (depth > maxDepth) {
      return;
    }
    const dirEntries = await readdirSafe(currentAbsolutePath);
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of dirEntries) {
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }
      const nextRelativePath = path.join(currentRelativePath, entry.name);
      const nextAbsolutePath = path.join(currentAbsolutePath, entry.name);
      if (entry.isDirectory()) {
        dirCount += 1;
        entries.push(nextRelativePath + '/');
        await walk(nextAbsolutePath, nextRelativePath, depth + 1);
        continue;
      }
      if (isIgnoredFile(entry.name)) {
        continue;
      }
      fileCount += 1;
      entries.push(nextRelativePath);
      const ext = path.extname(entry.name).toLowerCase() || '(no extension)';
      extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);
      if (keyFiles.length < 8 && isSourceFile(entry.name)) {
        keyFiles.push(nextRelativePath);
      }
    }
  }

  await walk(absolutePath, relativePath, 0);

  return {
    relativePath,
    fileCount,
    dirCount,
    extensionCounts,
    keyFiles,
    entries,
  };
}

async function detectPackageJson(root) {
  const packagePath = path.join(root, 'package.json');
  const pkg = await readJsonFile(packagePath);
  if (!pkg) {
    return null;
  }
  return {
    name: pkg.name || null,
    type: pkg.type || null,
    scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
    dependencies: Object.keys(pkg.dependencies || {}).length,
    devDependencies: Object.keys(pkg.devDependencies || {}).length,
  };
}

async function scanProjectLayout(root) {
  const topEntries = await readdirSafe(root);
  topEntries.sort((a, b) => a.name.localeCompare(b.name));

  const topLevelFiles = [];
  const topLevelDirectories = [];
  for (const entry of topEntries) {
    if (isIgnoredDirectory(entry.name) || isIgnoredFile(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      topLevelDirectories.push(entry.name);
    } else if (entry.isFile()) {
      topLevelFiles.push(entry.name);
    }
  }

  const sourceRoots = [];
  for (const candidate of SOURCE_ROOT_CANDIDATES) {
    const candidatePath = path.join(root, candidate);
    const stat = await fs.stat(candidatePath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      continue;
    }
    if (candidate === 'packages') {
      const packageChildren = await readdirSafe(candidatePath);
      for (const child of packageChildren) {
        if (!child.isDirectory() || isIgnoredDirectory(child.name)) {
          continue;
        }
        sourceRoots.push(path.join(candidate, child.name));
      }
      continue;
    }
    sourceRoots.push(candidate);
  }

  const rootCodeFiles = topLevelFiles.filter((file) => isSourceFile(file) && file !== 'package-lock.json');
  const nonModuleFiles = new Set([
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'README.md',
  ]);
  for (const file of rootCodeFiles.filter((name) => !nonModuleFiles.has(name)).slice(0, 8)) {
    sourceRoots.push(file);
  }

  return {
    topLevelFiles,
    topLevelDirectories,
    sourceRoots: [...new Set(sourceRoots)],
    packageJson: await detectPackageJson(root),
  };
}

function pickImportantTopLevelItems(layout) {
  const preferredFiles = ['package.json', 'README.md', 'tsconfig.json', 'jsconfig.json', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'next.config.mjs', 'wrangler.jsonc'];
  const files = [];
  for (const file of preferredFiles) {
    if (layout.topLevelFiles.includes(file)) {
      files.push(file);
    }
  }
  return files;
}

function summarizeGeneratedOverview({ state, layout, moduleSummaries }) {
  const sourceRoots = layout.sourceRoots.length ? layout.sourceRoots.map((item) => `\`${item}\``).join(', ') : 'не обнаружены';
  const importantFiles = pickImportantTopLevelItems(layout);
  const modules = moduleSummaries.slice(0, 5);
  const moduleLines = modules.length
    ? modules.map((summary) => `- \`${summary.relativePath}\`: ${summary.shortSummary}`)
    : ['- Исходные модули пока не обнаружены.'];

  return [
    `- Корень проекта: \`${state.projectRoot}\``,
    `- Последняя синхронизация: ${formatTimestamp(state.lastRefreshAt)}`,
    `- Активная роль: ${state.activeRole || 'не задана'}`,
    `- Выбранная модель: ${state.selectedModel || 'не задана'}`,
    `- Исходные каталоги: ${sourceRoots}`,
    importantFiles.length ? `- Важные файлы верхнего уровня: ${importantFiles.map((file) => `\`${file}\``).join(', ')}` : '- Важные файлы верхнего уровня: не обнаружены',
    '- Фокус по модулям:',
    ...moduleLines,
  ].join('\n');
}

function summarizeArchitectureNotes({ layout, packageJson, moduleSummaries }) {
  const lines = [];
  if (packageJson) {
    lines.push(`- Пакет: ${packageJson.name ? `\`${packageJson.name}\`` : 'без имени'}`);
    lines.push(`- Система модулей: ${packageJson.type || 'commonjs/default'}`);
    lines.push(`- Скрипты: ${packageJson.scripts.length ? packageJson.scripts.map((name) => `\`${name}\``).join(', ') : 'нет'}`);
  } else {
    lines.push('- package.json не найден');
  }

  lines.push(`- Кандидатные исходные каталоги: ${layout.sourceRoots.length ? layout.sourceRoots.map((item) => `\`${item}\``).join(', ') : 'нет'}`);
  if (moduleSummaries.length) {
    lines.push('- Структурные наблюдения:');
    for (const summary of moduleSummaries.slice(0, 6)) {
      lines.push(`  - \`${summary.relativePath}\`: ${summary.shortSummary}`);
    }
  }
  return lines.join('\n');
}

function summarizeModule(summary) {
  const extensionList = [...summary.extensionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ext, count]) => `\`${ext}\` x${count}`);
  const keyFiles = summary.keyFiles.length ? summary.keyFiles.map((item) => `\`${item}\``).join(', ') : 'не обнаружены';
  return [
    `- Файлов просканировано: ${summary.fileCount}`,
    `- Каталогов просканировано: ${summary.dirCount}`,
    `- Типы файлов: ${extensionList.length ? extensionList.join(', ') : 'не обнаружены'}`,
    `- Ключевые файлы: ${keyFiles}`,
    `- Краткое чтение: ${summary.shortSummary}`,
  ].join('\n');
}

function classifyDirectory(relativePath) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  const last = parts.at(-1) || relativePath;
  if (relativePath.includes(path.sep)) {
    return 'пакетный модуль';
  }
  if (last === 'src') {
    return 'основной исходный каталог';
  }
  if (last === 'app') {
    return 'область приложения';
  }
  if (last === 'components') {
    return 'общие компоненты';
  }
  if (last === 'server') {
    return 'server-side код';
  }
  if (last === 'client') {
    return 'client-side код';
  }
  if (last === 'lib') {
    return 'библиотечные утилиты';
  }
  return 'исходный каталог';
}

function buildSummaryHeadline(summary) {
  const type = summary.kind === 'file' ? 'файл' : classifyDirectory(summary.relativePath);
  return `- Тип: ${type}`;
}

async function buildModuleSummaries(root, layout) {
  const summaries = [];
  for (const relativePath of layout.sourceRoots) {
    const absolutePath = path.join(root, relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      const scan = await scanDirectorySummary(root, relativePath, 2);
      summaries.push({
        kind: 'directory',
        relativePath,
        title: `Сводка модуля: ${relativePath}`,
        generated: '',
        shortSummary: `${safeCount(scan.fileCount)} файлов, ${safeCount(scan.dirCount)} каталогов`,
        ...scan,
      });
      continue;
    }

    if (stat.isFile()) {
      const content = await readTextFile(absolutePath).catch(() => '');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(0, 8);
      const lineSummary = lines.length ? lines.join(' | ') : 'empty file';
      summaries.push({
        kind: 'file',
        relativePath,
        title: `Сводка модуля: ${relativePath}`,
        generated: '',
        shortSummary: lineSummary.length > 120 ? `${lineSummary.slice(0, 117)}...` : lineSummary,
        fileCount: 1,
        dirCount: 0,
        extensionCounts: new Map([[path.extname(relativePath).toLowerCase() || '(no extension)', 1]]),
        keyFiles: [relativePath],
        entries: [relativePath],
      });
    }
  }
  return summaries;
}

function buildModuleDocument(summary, existingContent) {
  const generated = [
    buildSummaryHeadline(summary),
    `- Путь: \`${summary.relativePath}\``,
    summary.kind === 'directory' ? `- ${summary.fileCount} файлов, ${summary.dirCount} каталогов` : '- Краткая сводка по одному файлу',
    `- Кратко: ${summary.shortSummary}`,
    '',
    summarizeModule(summary),
  ].join('\n');
  return renderSectionedDocument({
    title: summary.title,
    generated,
    existingContent,
  });
}

async function writeIfChanged(filePath, content) {
  const existing = await fileExists(filePath) ? await readTextFile(filePath) : null;
  if (existing === content) {
    return false;
  }
  await atomicWriteFile(filePath, content);
  return true;
}

async function writeMemoryFile(projectRoot, relativePath, content) {
  const filePath = resolveMemoryPath(projectRoot, relativePath);
  await ensureDirectory(path.dirname(filePath));
  return writeIfChanged(filePath, content);
}

export async function refreshProjectMemory(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const memory = await ensureProjectMemory(root);
  const stateBefore = (await readJsonFile(memory.statePath)) || {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    createdAt: nowIso(),
    lastRefreshAt: null,
    activeRole: null,
    selectedModel: null,
    currentTaskId: null,
    projectRoot: root,
  };
  const layout = await scanProjectLayout(root);
  const moduleSummaries = await buildModuleSummaries(root, layout);
  const nextState = await updateProjectState(root, {
    ...stateBefore,
    lastRefreshAt: nowIso(),
    projectRoot: root,
  });

  const generatedOverview = summarizeGeneratedOverview({
    state: nextState,
    layout,
    moduleSummaries,
  });
  const generatedArchitecture = summarizeArchitectureNotes({
    layout,
    packageJson: layout.packageJson,
    moduleSummaries,
  });
  const decisionsGenerated = [
    '- Автоматическая синхронизация завершена.',
    `- Последняя синхронизация: ${formatTimestamp(nextState.lastRefreshAt)}`,
    `- Модулей сводок: ${moduleSummaries.length}`,
    '- Ручные решения остаются в секции заметок ниже.',
  ].join('\n');

  const overviewPath = path.join(getMemoryRoot(root), BUILTIN_MEMORY_FILES.project_overview);
  const architecturePath = path.join(getMemoryRoot(root), BUILTIN_MEMORY_FILES.architecture_notes);
  const decisionsPath = path.join(getMemoryRoot(root), BUILTIN_MEMORY_FILES.decisions_log);

  const overviewExisting = await readTextFile(overviewPath).catch(() => '');
  const architectureExisting = await readTextFile(architecturePath).catch(() => '');
  const decisionsExisting = await readTextFile(decisionsPath).catch(() => '');

  await atomicWriteFile(
    overviewPath,
    renderSectionedDocument({
      title: 'Обзор проекта',
      generated: generatedOverview,
      existingContent: overviewExisting,
    }),
  );
  await atomicWriteFile(
    architecturePath,
    renderSectionedDocument({
      title: 'Архитектурные заметки',
      generated: generatedArchitecture,
      existingContent: architectureExisting,
    }),
  );
  await atomicWriteFile(
    decisionsPath,
    renderSectionedDocument({
      title: 'Журнал решений',
      generated: decisionsGenerated,
      existingContent: decisionsExisting,
    }),
  );

  for (const summary of moduleSummaries) {
    const relativeModulePath = path.join('module_summaries', `${summary.relativePath}.md`);
    const filePath = resolveMemoryPath(root, relativeModulePath);
    const existing = await readTextFile(filePath).catch(() => '');
    await ensureDirectory(path.dirname(filePath));
    await atomicWriteFile(filePath, buildModuleDocument(summary, existing));
  }

  return {
    state: nextState,
    layout,
    moduleSummaries,
  };
}

export async function rebuildProjectMemory(projectRoot) {
  return refreshProjectMemory(projectRoot);
}

export async function getProjectMemoryStatus(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const memoryRoot = getMemoryRoot(root);
  const exists = await fileExists(memoryRoot);
  const state = await readProjectState(root);
  const summariesRoot = path.join(memoryRoot, 'module_summaries');
  const summaryFiles = exists ? await listMarkdownFilesRecursive(summariesRoot) : [];
  const summaryCount = summaryFiles.length;
  return {
    exists,
    summaryCount,
    createdAt: state?.createdAt || null,
    updatedAt: state?.updatedAt || null,
    lastRefreshAt: state?.lastRefreshAt || null,
    selectedProvider: state?.selectedProvider || null,
    activeRole: state?.activeRole || null,
    selectedModel: state?.selectedModel || null,
    currentTaskId: state?.currentTaskId || null,
    projectRoot: root,
  };
}

export async function summarizeCurrentMemory(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const state = await readProjectState(root);
  const policy = await readProjectPolicy(root);
  if (!state) {
    return 'Память проекта еще не инициализирована.';
  }
  const memoryRoot = getMemoryRoot(root);
  const overview = await readTextFile(path.join(memoryRoot, BUILTIN_MEMORY_FILES.project_overview)).catch(() => '');
  const architecture = await readTextFile(path.join(memoryRoot, BUILTIN_MEMORY_FILES.architecture_notes)).catch(() => '');
  const overviewBlock = extractBlock(overview, GENERATED_START, GENERATED_END) || 'Сводка проекта еще не сгенерирована.';
  const architectureBlock = extractBlock(architecture, GENERATED_START, GENERATED_END) || 'Архитектурные заметки еще не сгенерированы.';
  const moduleSummaryNames = (await listMarkdownFilesRecursive(path.join(memoryRoot, 'module_summaries'))).sort();

  const listedModules = moduleSummaryNames.slice(0, 6).map((name) => `- ${name}`);
  return [
    `Корень проекта: ${state.projectRoot}`,
    `Выбранный провайдер: ${state.selectedProvider || 'не задан'}`,
    `Активная роль: ${state.activeRole || 'не задана'}`,
    `Выбранная модель: ${state.selectedModel || 'не задана'}`,
    `Текущая задача: ${state.currentTaskId || 'не задана'}`,
    `Режим подтверждения: ${policy.approvalMode}`,
    `Последняя синхронизация: ${formatTimestamp(state.lastRefreshAt)}`,
    '',
    'Обзор:',
    overviewBlock,
    '',
    'Архитектура:',
    architectureBlock,
    '',
    'Модули:',
    listedModules.length ? listedModules.join('\n') : '- Сводок модулей пока нет.',
  ].join('\n');
}

export async function showMemoryEntry(projectRoot, name) {
  const root = normalizeRoot(projectRoot);
  const memoryRoot = getMemoryRoot(root);
  const normalizedName = normalizeMemoryName(name);

  if (normalizedName === 'state') {
    const state = await readProjectState(root);
    if (!state) {
      throw new Error('Project memory state does not exist. Run `app project init` first.');
    }
    return `${JSON.stringify(state, null, 2)}\n`;
  }

  if (Object.prototype.hasOwnProperty.call(BUILTIN_MEMORY_FILES, normalizedName)) {
    const filePath = path.join(memoryRoot, BUILTIN_MEMORY_FILES[normalizedName]);
    return readTextFile(filePath);
  }

  const moduleSummaryPath = resolveMemoryPath(root, path.join('module_summaries', `${normalizedName}.md`));
  return readTextFile(moduleSummaryPath);
}

export async function listMemoryModuleSummaries(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const memoryRoot = getMemoryRoot(root);
  return (await listMarkdownFilesRecursive(path.join(memoryRoot, 'module_summaries'))).sort();
}

export function getMemoryRootPath(projectRoot) {
  return getMemoryRoot(projectRoot);
}

export function getBuiltinMemoryNames() {
  return { ...BUILTIN_MEMORY_FILES, state: 'state.json' };
}
