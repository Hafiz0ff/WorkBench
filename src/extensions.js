import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { readProjectState, updateProjectState } from './memory.js';

const EXTENSIONS_DIR_NAME = path.join('.local-codex', 'extensions');
const EXTENSIONS_INSTALLED_DIR_NAME = path.join('.local-codex', 'extensions', 'installed');
const EXTENSIONS_CACHE_DIR_NAME = path.join('.local-codex', 'extensions', 'cache');
const EXTENSIONS_REGISTRY_PATH_NAME = path.join('.local-codex', 'extensions', 'registry.json');
const EXTENSIONS_SCHEMA_VERSION = 1;
const DEFAULT_MANIFEST_NAME = 'localcodex-extension.json';
const SUPPORTED_TYPES = new Set(['skill', 'role-pack', 'template-pack', 'extension', 'mcp-connector']);
const SAFE_TYPES = new Set(['skill', 'role-pack', 'template-pack']);
const RISKY_CAPABILITIES = [
  'shell hooks',
  'network access',
  'external executable integration',
  'external executables',
  'script execution',
  'install scripts',
  'node packages',
  'binary execution',
];

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.writeFile(tempPath, content, encoding).then(() => fs.rename(tempPath, filePath));
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

async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

function normalizeExtensionId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Не указан идентификатор расширения.');
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) {
    throw new Error(`Недопустимый идентификатор расширения: ${value}`);
  }
  return normalized;
}

function extensionStorageName(extensionId) {
  return normalizeExtensionId(extensionId).replaceAll('/', '__');
}

function normalizePosixRelativePath(value) {
  const normalized = String(value || '').trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Недопустимый путь расширения: ${value}`);
  }
  return normalized.replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function getExtensionsRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), EXTENSIONS_DIR_NAME);
}

function getExtensionsInstalledRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), EXTENSIONS_INSTALLED_DIR_NAME);
}

function getExtensionsCacheRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), EXTENSIONS_CACHE_DIR_NAME);
}

function getExtensionsRegistryPath(projectRoot) {
  return path.join(normalizeRoot(projectRoot), EXTENSIONS_REGISTRY_PATH_NAME);
}

function getExtensionInstallPath(projectRoot, extensionId) {
  return path.join(getExtensionsInstalledRoot(projectRoot), extensionStorageName(extensionId));
}

function getExtensionManifestPath(projectRoot, extensionId) {
  return path.join(getExtensionInstallPath(projectRoot, extensionId), 'manifest.json');
}

function getExtensionSourceDescriptorPath(projectRoot, extensionId) {
  return path.join(getExtensionInstallPath(projectRoot, extensionId), 'source.json');
}

function getExtensionCapabilityLevel(capability) {
  const text = String(capability || '').trim().toLowerCase();
  if (!text) {
    return 'unknown';
  }
  if (RISKY_CAPABILITIES.some((needle) => text.includes(needle))) {
    return 'risky';
  }
  return 'safe';
}

function normalizeCapability(capability) {
  return String(capability || '').trim();
}

function normalizeManifestPath(value) {
  if (!value) {
    return DEFAULT_MANIFEST_NAME;
  }
  return normalizePosixRelativePath(value);
}

function isValidSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

function hashText(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function parseVersionParts(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Недопустимая версия: ${version}`);
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
}

function satisfiesComparator(version, comparator) {
  const match = String(comparator || '').trim().match(/^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error(`Недопустимый оператор совместимости: ${comparator}`);
  }
  const operator = match[1] || '=';
  const target = match[2];
  const diff = compareVersions(version, target);
  switch (operator) {
    case '>=': return diff >= 0;
    case '<=': return diff <= 0;
    case '>': return diff > 0;
    case '<': return diff < 0;
    case '=': return diff === 0;
    default: return false;
  }
}

function satisfiesVersionRange(version, range) {
  if (!range || !String(range).trim()) {
    return true;
  }
  return String(range)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => satisfiesComparator(version, token));
}

function normalizeGitHubRepoPathPath(value) {
  return String(value || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function repoBasePath(source) {
  return source.subdirectory ? normalizePosixRelativePath(source.subdirectory) : '';
}

function repoRelativePath(source, repoPath) {
  const normalizedRepoPath = normalizePosixRelativePath(repoPath);
  const base = repoBasePath(source);
  if (!base) {
    return normalizedRepoPath;
  }
  if (normalizedRepoPath === base) {
    return '';
  }
  const relative = path.posix.relative(base, normalizedRepoPath);
  if (relative.startsWith('..')) {
    throw new Error(`Путь выходит за пределы базовой папки расширения: ${repoPath}`);
  }
  return relative;
}

function repoFetchPath(source, relativePath) {
  const normalizedRelative = normalizePosixRelativePath(relativePath);
  const base = repoBasePath(source);
  return base ? path.posix.join(base, normalizedRelative) : normalizedRelative;
}

function parseGitHubUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error(`Неподдерживаемый GitHub URL: ${sourceUrl}`);
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Недопустимый GitHub URL: ${sourceUrl}`);
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  let ref = 'main';
  let subdirectory = '';
  let manifestPath = DEFAULT_MANIFEST_NAME;

  if (segments[2] === 'tree' || segments[2] === 'blob') {
    ref = segments[3] || ref;
    const rest = segments.slice(4).join('/');
    if (rest.endsWith(DEFAULT_MANIFEST_NAME)) {
      subdirectory = path.posix.dirname(rest);
      manifestPath = path.posix.basename(rest);
    } else if (rest) {
      subdirectory = rest;
      manifestPath = DEFAULT_MANIFEST_NAME;
    }
  } else if (segments.length > 2) {
    const rest = segments.slice(2).join('/');
    if (rest.endsWith(DEFAULT_MANIFEST_NAME)) {
      subdirectory = path.posix.dirname(rest);
      manifestPath = path.posix.basename(rest);
    } else {
      subdirectory = rest;
      manifestPath = DEFAULT_MANIFEST_NAME;
    }
  }

  if (url.searchParams.get('ref')) {
    ref = url.searchParams.get('ref') || ref;
  }

  return {
    kind: 'github',
    owner,
    repo,
    ref,
    subdirectory: normalizeGitHubRepoPathPath(subdirectory),
    manifestPath: normalizeManifestPath(manifestPath),
    url: sourceUrl,
  };
}

function parseGitHubRepoSpec(sourceSpec, options = {}) {
  if (typeof sourceSpec !== 'string' || !sourceSpec.trim()) {
    throw new Error('Не указан источник расширения.');
  }
  const trimmed = sourceSpec.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const parsed = parseGitHubUrl(trimmed);
    if (options.ref) {
      parsed.ref = options.ref;
    }
    if (options.path) {
      parsed.subdirectory = normalizeGitHubRepoPathPath(options.path);
      parsed.manifestPath = DEFAULT_MANIFEST_NAME;
    }
    return parsed;
  }

  const [repoPart, pathPart = ''] = trimmed.split(':', 2);
  const repoMatch = repoPart.match(/^([^/@]+)\/([^@]+)(?:@(.+))?$/);
  if (!repoMatch) {
    throw new Error(`Недопустимый источник GitHub: ${sourceSpec}`);
  }
  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, '');
  const ref = options.ref || repoMatch[3] || 'main';
  const subdirectory = normalizeGitHubRepoPathPath(options.path || pathPart);
  return {
    kind: 'github',
    owner,
    repo,
    ref,
    subdirectory,
    manifestPath: DEFAULT_MANIFEST_NAME,
    url: `https://github.com/${owner}/${repo}`,
  };
}

function normalizeSourceDescriptor(source, options = {}) {
  if (typeof source === 'string') {
    return parseGitHubRepoSpec(source, options);
  }
  if (!source || typeof source !== 'object') {
    throw new Error('Недопустимый источник расширения.');
  }
  if (source.kind === 'github') {
    return parseGitHubRepoSpec(`${source.owner}/${source.repo}`, {
      ref: source.ref,
      path: source.subdirectory,
      ...options,
    });
  }
  throw new Error(`Неподдерживаемый тип источника расширения: ${source.kind}`);
}

async function fetchGitHubContentsJson(source, filePath) {
  const repoPath = repoFetchPath(source, filePath);
  const apiUrl = new URL(`https://api.github.com/repos/${source.owner}/${source.repo}/contents/${repoPath}`);
  apiUrl.searchParams.set('ref', source.ref);
  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'localcodex-extension-installer',
    },
  });
  if (!response.ok) {
    throw new Error(`Ошибка GitHub API ${response.status} для ${filePath}`);
  }
  return response.json();
}

async function fetchGitHubTextFile(source, filePath) {
  const json = await fetchGitHubContentsJson(source, filePath);
  if (Array.isArray(json)) {
    throw new Error(`Ожидался файл, но найдена папка: ${filePath}`);
  }
  if (json.encoding !== 'base64' || typeof json.content !== 'string') {
    throw new Error(`Неподдерживаемое кодирование файла для ${filePath}`);
  }
  const text = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return {
    text,
    sha: json.sha || null,
    path: repoRelativePath(source, json.path || filePath),
  };
}

async function fetchGitHubPathTree(source, targetPath, visitor) {
  const normalized = normalizePosixRelativePath(targetPath);
  const json = await fetchGitHubContentsJson(source, normalized);
  if (!Array.isArray(json)) {
    await visitor({
      path: repoRelativePath(source, json.path || normalized),
      text: Buffer.from(String(json.content || '').replace(/\n/g, ''), 'base64').toString('utf8'),
      sha: json.sha || null,
      type: 'file',
    });
    return;
  }

  for (const entry of json) {
    if (entry.type === 'dir') {
      await fetchGitHubPathTree(source, repoRelativePath(source, entry.path), visitor);
      continue;
    }
    if (entry.type === 'file') {
      const file = await fetchGitHubTextFile(source, repoRelativePath(source, entry.path));
      await visitor({ ...file, type: 'file' });
    }
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readTextFile(filePath));
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, data) {
  await atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function defaultRegistry() {
  return {
    schemaVersion: EXTENSIONS_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    extensions: [],
  };
}

async function readPackageVersion(projectRoot) {
  const packageJsonPath = path.join(normalizeRoot(projectRoot), 'package.json');
  const pkg = await readJsonFile(packageJsonPath);
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
}

export function getSafeExtensionTypes() {
  return [...SAFE_TYPES];
}

export function getExtensionWorkspacePaths(projectRoot) {
  const root = normalizeRoot(projectRoot);
  return {
    extensionsRoot: path.join(root, EXTENSIONS_DIR_NAME),
    installedRoot: getExtensionsInstalledRoot(root),
    cacheRoot: getExtensionsCacheRoot(root),
    registryPath: getExtensionsRegistryPath(root),
  };
}

export async function ensureExtensionsWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const { extensionsRoot, installedRoot, cacheRoot, registryPath } = getExtensionWorkspacePaths(root);
  await ensureDirectory(extensionsRoot);
  await ensureDirectory(installedRoot);
  await ensureDirectory(cacheRoot);
  if (!(await fileExists(registryPath))) {
    await writeJsonFile(registryPath, defaultRegistry());
  }
  return getExtensionWorkspacePaths(root);
}

export async function readExtensionsRegistry(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureExtensionsWorkspace(root);
  const registry = await readJsonFile(getExtensionsRegistryPath(root));
  return registry || defaultRegistry();
}

export async function writeExtensionsRegistry(projectRoot, registry) {
  const root = normalizeRoot(projectRoot);
  await ensureExtensionsWorkspace(root);
  await writeJsonFile(getExtensionsRegistryPath(root), registry);
  return registry;
}

function normalizeRegistryEntry(entry, { enabledDefault = false } = {}) {
  const id = normalizeExtensionId(entry.id);
  const type = String(entry.type || '').trim();
  const enabled = typeof entry.enabled === 'boolean' ? entry.enabled : enabledDefault;
  return {
    id,
    name: String(entry.name || id).trim(),
    version: String(entry.version || '0.0.0').trim(),
    type,
    author: String(entry.author || '').trim(),
    description: String(entry.description || '').trim(),
    source: entry.source || null,
    manifestPath: String(entry.manifestPath || '').trim(),
    installPath: String(entry.installPath || '').trim(),
    entryPaths: Array.isArray(entry.entryPaths) ? entry.entryPaths.map(normalizePosixRelativePath) : [],
    capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map(normalizeCapability) : [],
    compatibility: entry.compatibility || null,
    localization: entry.localization || null,
    publisher: String(entry.publisher || '').trim(),
    reviewStatus: String(entry.reviewStatus || '').trim(),
    verifiedSource: typeof entry.verifiedSource === 'boolean' ? entry.verifiedSource : null,
    supportedAppVersions: Array.isArray(entry.supportedAppVersions) ? entry.supportedAppVersions.map((value) => String(value).trim()).filter(Boolean) : [],
    signature: String(entry.signature || '').trim(),
    lastCheckedAt: String(entry.lastCheckedAt || '').trim(),
    trustLevel: String(entry.trustLevel || '').trim(),
    recommended: typeof entry.recommended === 'boolean' ? entry.recommended : false,
    registrySourceId: String(entry.registrySourceId || '').trim(),
    registrySourceLabel: String(entry.registrySourceLabel || '').trim(),
    registrySourceLocation: String(entry.registrySourceLocation || '').trim(),
    registryEntryId: String(entry.registryEntryId || '').trim(),
    installSourceType: String(entry.installSourceType || (entry.registrySourceId ? 'registry' : 'github')).trim() || 'github',
    hashes: entry.hashes || null,
    enabled,
    status: entry.status || (enabled ? 'enabled' : 'disabled'),
    warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : [],
    installedAt: entry.installedAt || nowIso(),
    updatedAt: entry.updatedAt || nowIso(),
    lastValidatedAt: entry.lastValidatedAt || null,
  };
}

export function validateExtensionManifest(manifest, { appVersion = '0.0.0' } = {}) {
  const issues = [];
  const normalized = manifest && typeof manifest === 'object' ? manifest : null;
  if (!normalized) {
    return { valid: false, issues: ['Manifest отсутствует или недопустим.'] };
  }

  if (normalized.schemaVersion !== EXTENSIONS_SCHEMA_VERSION) {
    issues.push(`Неподдерживаемая версия схемы: ${normalized.schemaVersion}`);
  }
  if (typeof normalized.id !== 'string' || !normalized.id.trim()) {
    issues.push('Manifest id обязателен.');
  } else if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(normalized.id.trim())) {
    issues.push(`Недопустимый manifest id: ${normalized.id}`);
  }
  if (typeof normalized.name !== 'string' || !normalized.name.trim()) {
    issues.push('Manifest name обязателен.');
  }
  if (typeof normalized.version !== 'string' || !normalized.version.trim()) {
    issues.push('Manifest version обязателен.');
  }
  if (!SUPPORTED_TYPES.has(String(normalized.type || '').trim())) {
    issues.push(`Неподдерживаемый тип расширения: ${normalized.type}`);
  }
  if (typeof normalized.author !== 'string' || !normalized.author.trim()) {
    issues.push('Manifest author обязателен.');
  }
  if (typeof normalized.description !== 'string' || !normalized.description.trim()) {
    issues.push('Manifest description обязателен.');
  }
  if (!Array.isArray(normalized.entryPaths) || normalized.entryPaths.length === 0) {
    issues.push('Manifest entryPaths не должен быть пустым.');
  } else {
    for (const entryPath of normalized.entryPaths) {
      try {
        normalizePosixRelativePath(entryPath);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (!Array.isArray(normalized.capabilities)) {
    issues.push('Manifest capabilities должен быть массивом.');
  }
  if (!normalized.source || typeof normalized.source !== 'object' || normalized.source.kind !== 'github') {
    issues.push('На этом этапе поддерживаются только GitHub-источники.');
  }
  if (!normalized.compatibility || typeof normalized.compatibility !== 'object') {
    issues.push('Manifest compatibility обязателен.');
  } else {
    if (!satisfiesVersionRange(appVersion, normalized.compatibility.app || '')) {
      issues.push(`Версия приложения ${appVersion} несовместима с ${normalized.compatibility.app || 'диапазон app не задан'}.`);
    }
    if (normalized.compatibility.schema && String(normalized.compatibility.schema) !== String(EXTENSIONS_SCHEMA_VERSION)) {
      issues.push(`Несовпадение совместимости схемы: ${normalized.compatibility.schema}`);
    }
  }
  if (normalized.hashes) {
    if (normalized.hashes.manifest && !isValidSha256(normalized.hashes.manifest)) {
    issues.push('Недопустимый хеш manifest.');
    }
    if (normalized.hashes.entries && typeof normalized.hashes.entries === 'object') {
      for (const [entryPath, digest] of Object.entries(normalized.hashes.entries)) {
        if (!isValidSha256(digest)) {
          issues.push(`Недопустимый хеш entry для ${entryPath}.`);
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    manifest: normalized,
  };
}

function classifyExtensionRisk(manifest) {
  const capabilityLevels = (Array.isArray(manifest.capabilities) ? manifest.capabilities : [])
    .map((capability) => ({
      capability,
      level: getExtensionCapabilityLevel(capability),
    }));
  const riskyCapabilities = capabilityLevels.filter((item) => item.level === 'risky').map((item) => item.capability);
  const safeType = SAFE_TYPES.has(String(manifest.type || '').trim());
  const typeRisk = safeType ? 'safe' : 'risky';
  return {
    typeRisk,
    capabilityLevels,
    riskyCapabilities,
    requiresApproval: typeRisk === 'risky' || riskyCapabilities.length > 0,
  };
}

function readGitHubManifestText(text, source, manifestPath) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось разобрать manifest расширения в ${manifestPath}: ${parseError}`);
  }
}

export async function fetchExtensionManifest(sourceSpec, options = {}) {
  const source = normalizeSourceDescriptor(sourceSpec, options);
  if (source.kind !== 'github') {
    throw new Error(`Неподдерживаемый тип источника расширения: ${source.kind}`);
  }
  const manifestPath = normalizeManifestPath(options.manifestPath || source.manifestPath);
  const manifestText = await fetchGitHubTextFile(source, manifestPath).catch((error) => {
    throw new Error(`Не удалось получить manifest расширения: ${error instanceof Error ? error.message : String(error)}`);
  });
  const manifest = readGitHubManifestText(manifestText.text, source, manifestPath);
  return {
    source,
    manifestPath,
    manifest,
    manifestHash: hashText(manifestText.text),
    manifestText: manifestText.text,
  };
}

async function writeFileTree(projectRoot, installPath, relativePath, text) {
  const root = normalizeRoot(projectRoot);
  const resolvedInstallPath = resolveWithinRoot(root, path.relative(root, installPath));
  const outputPath = path.join(resolvedInstallPath, normalizePosixRelativePath(relativePath));
  await ensureDirectory(path.dirname(outputPath));
  await fs.writeFile(outputPath, text, 'utf8');
}

async function fetchAndStoreEntryPaths(projectRoot, installPath, source, entryPaths) {
  const copiedFiles = [];
  const entryHashes = {};

  for (const entryPath of entryPaths) {
    const normalizedEntryPath = normalizePosixRelativePath(entryPath);
    await fetchGitHubPathTree(source, normalizedEntryPath, async (file) => {
      const storedPath = path.join(installPath, file.path);
      await ensureDirectory(path.dirname(storedPath));
      await fs.writeFile(storedPath, file.text, 'utf8');
      copiedFiles.push(file.path);
      entryHashes[file.path] = hashText(file.text);
    });
  }

  return { copiedFiles, entryHashes };
}

async function buildRegistryEntryFromManifest(projectRoot, manifest, source, manifestPath, installPath, options = {}) {
  const hashes = {
    manifest: options.manifestHash || hashText(JSON.stringify(manifest)),
    entries: options.entryHashes || {},
  };
  return normalizeRegistryEntry({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    author: manifest.author,
    description: manifest.description,
    source,
    manifestPath,
    installPath,
    entryPaths: manifest.entryPaths,
    capabilities: manifest.capabilities,
    compatibility: manifest.compatibility,
    localization: manifest.localization || null,
    publisher: options.publisher || manifest.publisher || '',
    reviewStatus: options.reviewStatus || manifest.reviewStatus || '',
    verifiedSource: typeof options.verifiedSource === 'boolean' ? options.verifiedSource : manifest.verifiedSource ?? null,
    supportedAppVersions: Array.isArray(options.supportedAppVersions)
      ? options.supportedAppVersions
      : Array.isArray(manifest.supportedAppVersions)
        ? manifest.supportedAppVersions
        : [],
    signature: options.signature || manifest.signature || '',
    lastCheckedAt: options.lastCheckedAt || nowIso(),
    trustLevel: options.trustLevel || manifest.trustLevel || '',
    recommended: typeof options.recommended === 'boolean' ? options.recommended : Boolean(manifest.recommended),
    registrySourceId: options.registrySourceId || '',
    registrySourceLabel: options.registrySourceLabel || '',
    registrySourceLocation: options.registrySourceLocation || '',
    registryEntryId: options.registryEntryId || '',
    installSourceType: options.installSourceType || (options.registrySourceId ? 'registry' : 'github'),
    hashes,
    enabled: false,
    status: 'disabled',
    warnings: options.warnings || [],
    installedAt: nowIso(),
    updatedAt: nowIso(),
    lastValidatedAt: nowIso(),
  });
}

async function promptConfirmation(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} `);
    return ['y', 'yes', 'да', 'д', 'ok'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

function extensionSummary(manifest, risk) {
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities.join(', ') : '';
  const warnings = [];
  if (risk.typeRisk === 'risky') {
    warnings.push(`type:${manifest.type}`);
  }
  if (risk.riskyCapabilities.length) {
    warnings.push(...risk.riskyCapabilities.map((capability) => `capability:${capability}`));
  }
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    author: manifest.author,
    description: manifest.description,
    capabilities,
    warnings,
  };
}

export async function previewExtensionInstall(projectRoot, sourceSpec, options = {}) {
  const root = normalizeRoot(projectRoot);
  const { manifest, source, manifestPath, manifestHash } = await fetchExtensionManifest(sourceSpec, options);
  const appVersion = await readPackageVersion(root);
  const validation = validateExtensionManifest(manifest, { appVersion });
  if (!validation.valid) {
    return {
      ok: false,
      source,
      manifestPath,
      manifest: validation.manifest,
      issues: validation.issues,
      risk: null,
    };
  }

  const risk = classifyExtensionRisk(validation.manifest);
  return {
    ok: true,
    source,
    manifestPath,
    manifest: validation.manifest,
    manifestHash,
    risk,
    summary: extensionSummary(validation.manifest, risk),
    approvalRequired: risk.requiresApproval,
  };
}

export async function installExtension(projectRoot, sourceSpec, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensureExtensionsWorkspace(root);
  const preview = await previewExtensionInstall(root, sourceSpec, options);
  if (!preview.ok) {
    throw new Error(preview.issues.join('; '));
  }
  if (preview.approvalRequired && !options.confirm) {
    const approved = await promptConfirmation(options.confirmMessage || 'Подтвердить установку расширения?');
    if (!approved) {
      throw new Error('Установка расширения не подтверждена.');
    }
  }

  const installPath = getExtensionInstallPath(root, preview.manifest.id);
  await fs.rm(installPath, { recursive: true, force: true });
  await ensureDirectory(installPath);
  await fs.writeFile(path.join(installPath, 'manifest.json'), `${JSON.stringify(preview.manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(installPath, 'source.json'), `${JSON.stringify(preview.source, null, 2)}\n`, 'utf8');
  const { copiedFiles, entryHashes } = await fetchAndStoreEntryPaths(root, installPath, preview.source, preview.manifest.entryPaths);
  const registry = await readExtensionsRegistry(root);
  const nextRegistry = {
    ...registry,
    schemaVersion: EXTENSIONS_SCHEMA_VERSION,
    updatedAt: nowIso(),
    extensions: (Array.isArray(registry.extensions) ? registry.extensions : [])
      .filter((entry) => normalizeExtensionId(entry.id) !== normalizeExtensionId(preview.manifest.id))
      .concat([await buildRegistryEntryFromManifest(root, preview.manifest, preview.source, path.join(installPath, 'manifest.json'), installPath, {
        manifestHash: preview.manifestHash,
        entryHashes,
        warnings: preview.risk?.riskyCapabilities || [],
        publisher: options.publisher,
        reviewStatus: options.reviewStatus,
        verifiedSource: options.verifiedSource,
        supportedAppVersions: options.supportedAppVersions,
        signature: options.signature,
        trustLevel: options.trustLevel,
        recommended: options.recommended,
        registrySourceId: options.registrySourceId,
        registrySourceLabel: options.registrySourceLabel,
        registrySourceLocation: options.registrySourceLocation,
        registryEntryId: options.registryEntryId,
        lastCheckedAt: options.lastCheckedAt,
        installSourceType: options.installSourceType || (options.registrySourceId ? 'registry' : 'github'),
      })]),
  };
  await writeExtensionsRegistry(root, nextRegistry);
  return {
    installed: true,
    enabled: false,
    installPath,
    registryEntry: nextRegistry.extensions.find((entry) => entry.id === preview.manifest.id),
    copiedFiles,
    preview,
  };
}

export async function getInstalledExtension(projectRoot, extensionId) {
  const registry = await readExtensionsRegistry(projectRoot);
  const id = normalizeExtensionId(extensionId);
  return (Array.isArray(registry.extensions) ? registry.extensions : []).find((entry) => normalizeExtensionId(entry.id) === id) || null;
}

export async function listInstalledExtensions(projectRoot, { enabledOnly = false } = {}) {
  const registry = await readExtensionsRegistry(projectRoot);
  const extensions = Array.isArray(registry.extensions) ? registry.extensions : [];
  return extensions
    .filter((entry) => !enabledOnly || entry.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function enableExtension(projectRoot, extensionId, options = {}) {
  const root = normalizeRoot(projectRoot);
  const registry = await readExtensionsRegistry(root);
  const id = normalizeExtensionId(extensionId);
  const extensions = Array.isArray(registry.extensions) ? registry.extensions : [];
  const entry = extensions.find((item) => normalizeExtensionId(item.id) === id);
  if (!entry) {
    throw new Error(`Расширение не найдено: ${extensionId}`);
  }

  const manifestPath = path.join(getExtensionInstallPath(root, entry.id), 'manifest.json');
  const manifest = await readJsonFile(manifestPath);
  const validation = validateExtensionManifest(manifest, { appVersion: await readPackageVersion(root) });
  if (!validation.valid) {
    throw new Error(validation.issues.join('; '));
  }
  const risk = classifyExtensionRisk(validation.manifest);
  if (risk.requiresApproval && !options.confirm) {
    const approved = await promptConfirmation(options.confirmMessage || 'Подтвердить включение этого расширения?');
    if (!approved) {
      throw new Error('Включение расширения не подтверждено.');
    }
  }

  entry.enabled = true;
  entry.status = 'enabled';
  entry.updatedAt = nowIso();
  entry.lastValidatedAt = nowIso();
  await writeExtensionsRegistry(root, {
    ...registry,
    updatedAt: nowIso(),
    extensions,
  });
  await updateProjectState(root, { lastExtensionRefreshAt: nowIso() });
  return entry;
}

export async function disableExtension(projectRoot, extensionId) {
  const root = normalizeRoot(projectRoot);
  const registry = await readExtensionsRegistry(root);
  const id = normalizeExtensionId(extensionId);
  const extensions = Array.isArray(registry.extensions) ? registry.extensions : [];
  const entry = extensions.find((item) => normalizeExtensionId(item.id) === id);
  if (!entry) {
    throw new Error(`Расширение не найдено: ${extensionId}`);
  }
  entry.enabled = false;
  entry.status = 'disabled';
  entry.updatedAt = nowIso();
  await writeExtensionsRegistry(root, {
    ...registry,
    updatedAt: nowIso(),
    extensions,
  });
  await updateProjectState(root, { lastExtensionRefreshAt: nowIso() });
  return entry;
}

export async function removeExtension(projectRoot, extensionId) {
  const root = normalizeRoot(projectRoot);
  const registry = await readExtensionsRegistry(root);
  const id = normalizeExtensionId(extensionId);
  const extensions = Array.isArray(registry.extensions) ? registry.extensions : [];
  const entry = extensions.find((item) => normalizeExtensionId(item.id) === id);
  if (!entry) {
    throw new Error(`Расширение не найдено: ${extensionId}`);
  }
  await fs.rm(getExtensionInstallPath(root, id), { recursive: true, force: true });
  const nextExtensions = extensions.filter((item) => normalizeExtensionId(item.id) !== id);
  await writeExtensionsRegistry(root, {
    ...registry,
    updatedAt: nowIso(),
    extensions: nextExtensions,
  });
  await updateProjectState(root, { lastExtensionRefreshAt: nowIso() });
  return entry;
}

export async function updateExtension(projectRoot, extensionId, options = {}) {
  const current = await getInstalledExtension(projectRoot, extensionId);
  if (!current) {
    throw new Error(`Расширение не найдено: ${extensionId}`);
  }
  const result = await installExtension(projectRoot, `${current.source.owner}/${current.source.repo}`, {
    ...options,
    ref: current.source.ref,
    path: current.source.subdirectory,
    confirm: true,
    installSourceType: current.registrySourceId ? 'registry' : 'github',
    registrySourceId: current.registrySourceId || undefined,
    registrySourceLabel: current.registrySourceLabel || undefined,
    registrySourceLocation: current.registrySourceLocation || undefined,
    registryEntryId: current.registryEntryId || undefined,
    trustLevel: current.trustLevel || undefined,
    reviewStatus: current.reviewStatus || undefined,
    verifiedSource: current.verifiedSource ?? undefined,
    supportedAppVersions: current.supportedAppVersions || undefined,
    signature: current.signature || undefined,
    publisher: current.publisher || undefined,
    recommended: current.recommended,
  });
  const registry = await readExtensionsRegistry(projectRoot);
  const entry = (Array.isArray(registry.extensions) ? registry.extensions : []).find((item) => normalizeExtensionId(item.id) === normalizeExtensionId(current.id));
  if (entry) {
    entry.enabled = current.enabled;
    entry.status = current.enabled ? 'enabled' : 'disabled';
    await writeExtensionsRegistry(projectRoot, {
      ...registry,
      updatedAt: nowIso(),
      extensions: registry.extensions,
    });
  }
  if (current.enabled && !result.registryEntry.enabled) {
    await enableExtension(projectRoot, current.id, { confirm: true });
  }
  return result;
}

function formatExtensionManifest(manifest) {
  return [
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `version: ${manifest.version}`,
    `type: ${manifest.type}`,
    `author: ${manifest.author}`,
    `description: ${manifest.description}`,
    `entryPaths: ${(manifest.entryPaths || []).join(', ') || '-'}`,
    `capabilities: ${(manifest.capabilities || []).join(', ') || '-'}`,
    `installNotes: ${manifest.installNotes || '-'}`,
  ].join('\n');
}

export async function inspectExtension(projectRoot, extensionId) {
  const entry = await getInstalledExtension(projectRoot, extensionId);
  if (!entry) {
    throw new Error(`Расширение не найдено: ${extensionId}`);
  }
  const manifest = await readJsonFile(path.join(getExtensionInstallPath(projectRoot, entry.id), 'manifest.json'));
  const source = await readJsonFile(path.join(getExtensionInstallPath(projectRoot, entry.id), 'source.json'));
  return {
    entry,
    manifest,
    source,
    manifestText: manifest ? formatExtensionManifest(manifest) : '',
  };
}

export async function doctorExtensions(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const registry = await readExtensionsRegistry(root);
  const extensions = Array.isArray(registry.extensions) ? registry.extensions : [];
  const issues = [];
  const appVersion = await readPackageVersion(root);

  for (const entry of extensions) {
    const installPath = getExtensionInstallPath(root, entry.id);
    if (!(await fileExists(installPath))) {
      issues.push({ id: entry.id, severity: 'error', message: 'Путь установки отсутствует.' });
      continue;
    }
    const manifestPath = path.join(installPath, 'manifest.json');
    const manifest = await readJsonFile(manifestPath);
    if (!manifest) {
      issues.push({ id: entry.id, severity: 'error', message: 'Manifest отсутствует или недопустим.' });
      continue;
    }
    const validation = validateExtensionManifest(manifest, { appVersion });
    if (!validation.valid) {
      for (const issue of validation.issues) {
        issues.push({ id: entry.id, severity: 'error', message: issue });
      }
    }
      for (const entryPath of manifest.entryPaths || []) {
      const resolved = path.join(installPath, normalizePosixRelativePath(entryPath));
      if (!(await fileExists(resolved))) {
        issues.push({ id: entry.id, severity: 'error', message: `Отсутствует файл entry: ${entryPath}` });
      }
    }
    if (entry.enabled && classifyExtensionRisk(manifest).requiresApproval) {
      issues.push({ id: entry.id, severity: 'warning', message: 'Расширение включено, но запрашивает рискованные возможности.' });
    }
  }

  return {
    registry,
    extensions,
    issues,
    healthy: issues.filter((issue) => issue.severity === 'error').length === 0,
  };
}

async function readFilesFromDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readFilesFromDirectory(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function parseRoleMarkdown(filePath, content, sourceExtensionId) {
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf('---');
  if (start === -1) {
    return null;
  }
  const end = lines.slice(start + 1).indexOf('---');
  if (end === -1) {
    return null;
  }
  const body = lines.slice(start + 1, start + 1 + end);
  const fields = {};
  let currentField = null;
  for (const line of body) {
    if (/^[A-Za-z0-9_]+:\s*/.test(line)) {
      const [key, value] = line.split(/:\s*/, 2);
      currentField = key;
      if (value && value.trim()) {
        fields[key] = value.trim();
      } else {
        fields[key] = [];
      }
      continue;
    }
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentField) {
      if (!Array.isArray(fields[currentField])) {
        fields[currentField] = [];
      }
      fields[currentField].push(listMatch[1].trim());
    }
  }
  if (typeof fields.name !== 'string' || !fields.name.trim()) {
    return null;
  }
  return {
    name: fields.name.trim(),
    description: String(fields.description || '').trim(),
    goals: Array.isArray(fields.goals) ? fields.goals : [],
    behavioralRules: Array.isArray(fields.behavioral_rules) ? fields.behavioral_rules : [],
    toolUsageGuidance: Array.isArray(fields.tool_usage_guidance) ? fields.tool_usage_guidance : [],
    outputStyle: Array.isArray(fields.output_style) ? fields.output_style : [],
    do: Array.isArray(fields.do) ? fields.do : [],
    dont: Array.isArray(fields.dont) ? fields.dont : [],
    filePath,
    sourceExtensionId,
  };
}

function parsePromptPack(filePath, content, sourceExtensionId) {
  const name = path.basename(filePath, path.extname(filePath));
  return {
    name,
    filePath,
    content,
    sourceExtensionId,
  };
}

function parseTaskTemplate(filePath, content, sourceExtensionId) {
  const name = path.basename(filePath, path.extname(filePath));
  return {
    name,
    filePath,
    content,
    sourceExtensionId,
  };
}

export async function listEnabledExtensionRoleProfiles(projectRoot) {
  const extensions = await listInstalledExtensions(projectRoot, { enabledOnly: true });
  const profiles = [];
  for (const extension of extensions) {
    const rolesDir = path.join(getExtensionInstallPath(projectRoot, extension.id), 'roles');
    const files = await readFilesFromDirectory(rolesDir);
    for (const filePath of files.filter((file) => file.endsWith('.md'))) {
      const content = await readTextFile(filePath).catch(() => '');
      const profile = parseRoleMarkdown(filePath, content, extension.id);
      if (profile) {
        profiles.push(profile);
      }
    }
  }
  return profiles;
}

export async function listEnabledExtensionPromptPacks(projectRoot) {
  const extensions = await listInstalledExtensions(projectRoot, { enabledOnly: true });
  const packs = [];
  for (const extension of extensions) {
    const promptsDir = path.join(getExtensionInstallPath(projectRoot, extension.id), 'prompts');
    const files = await readFilesFromDirectory(promptsDir);
    for (const filePath of files.filter((file) => /\.(md|txt|prompt)$/i.test(file))) {
      const content = await readTextFile(filePath).catch(() => '');
      packs.push(parsePromptPack(filePath, content, extension.id));
    }
  }
  return packs;
}

export async function listEnabledExtensionTaskTemplates(projectRoot) {
  const extensions = await listInstalledExtensions(projectRoot, { enabledOnly: true });
  const templates = [];
  for (const extension of extensions) {
    const templatesDir = path.join(getExtensionInstallPath(projectRoot, extension.id), 'tasks', 'templates');
    const files = await readFilesFromDirectory(templatesDir);
    for (const filePath of files) {
      const content = await readTextFile(filePath).catch(() => '');
      templates.push(parseTaskTemplate(filePath, content, extension.id));
    }
  }
  return templates;
}

export async function getExtensionCatalog(projectRoot) {
  const registry = await readExtensionsRegistry(projectRoot);
  return {
    registry,
    extensions: Array.isArray(registry.extensions) ? registry.extensions : [],
    roleProfiles: await listEnabledExtensionRoleProfiles(projectRoot),
    promptPacks: await listEnabledExtensionPromptPacks(projectRoot),
    taskTemplates: await listEnabledExtensionTaskTemplates(projectRoot),
  };
}

export function formatExtensionSummary(entry) {
  const sourceLabel = entry.installSourceType === 'registry'
    ? `registry:${entry.registrySourceLabel || entry.registrySourceId || '-'}`
    : 'github';
  const trustBits = [
    entry.reviewStatus ? `review:${entry.reviewStatus}` : null,
    entry.trustLevel ? `trust:${entry.trustLevel}` : null,
    entry.verifiedSource === true ? 'verified' : entry.verifiedSource === false ? 'unverified' : null,
  ].filter(Boolean);
  return [
    `${entry.enabled ? '[enabled]' : '[disabled]'} ${entry.name} (${entry.id})`,
    `  type: ${entry.type}`,
    `  version: ${entry.version}`,
    `  author: ${entry.author || '-'}`,
    `  capabilities: ${(entry.capabilities || []).join(', ') || '-'}`,
    `  source: ${sourceLabel}`,
    `  trust: ${trustBits.join(', ') || '-'}`,
    `  path: ${entry.installPath || '-'}`,
  ].join('\n');
}

export function getExtensionInstallLocation(projectRoot, extensionId) {
  return getExtensionInstallPath(projectRoot, extensionId);
}
