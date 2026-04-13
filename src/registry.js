import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeRoot } from './security.js';
import { installExtension, previewExtensionInstall } from './extensions.js';

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_SOURCES_PATH = path.join('.local-codex', 'extensions', 'sources.json');
const REGISTRY_CATALOG_PATH = path.join('.local-codex', 'extensions', 'catalog.json');
const REGISTRY_CACHE_DIR = path.join('.local-codex', 'extensions', 'catalog-cache');
const CURATED_REGISTRY_FILE = 'extensions-registry.json';
const REVIEW_STATUSES = new Set(['reviewed', 'trusted', 'experimental', 'pending']);
const TRUST_LEVELS = new Set(['recommended', 'reviewed', 'experimental']);

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

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
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
    return false;
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

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function normalizeLocation(input, projectRoot) {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('Не указан источник каталога расширений.');
  }
  if (value.startsWith('file://')) {
    return { kind: 'file', location: decodeURIComponent(new URL(value).pathname), raw: value };
  }
  if (isHttpUrl(value)) {
    return { kind: 'url', location: value, raw: value };
  }
  const resolved = path.isAbsolute(value) ? value : path.resolve(normalizeRoot(projectRoot), value);
  return { kind: 'file', location: resolved, raw: value };
}

function sourceIdForLocation(location) {
  return `source-${hashText(location)}`;
}

function defaultSourceLabel(location) {
  if (isHttpUrl(location)) {
    try {
      const url = new URL(location);
      return path.posix.basename(url.pathname) || url.hostname;
    } catch {
      return location;
    }
  }
  return path.basename(location) || location;
}

function defaultRegistrySources() {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sources: [],
  };
}

function defaultRegistryCatalog() {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sources: [],
    entries: [],
    issues: [],
  };
}

function normalizeSourceEntry(entry) {
  return {
    id: String(entry.id || '').trim(),
    location: String(entry.location || '').trim(),
    kind: String(entry.kind || '').trim() || (String(entry.location || '').startsWith('http') ? 'url' : 'file'),
    label: String(entry.label || '').trim(),
    publisher: String(entry.publisher || '').trim(),
    reviewStatus: String(entry.reviewStatus || '').trim(),
    verifiedSource: typeof entry.verifiedSource === 'boolean' ? entry.verifiedSource : null,
    trustLevel: String(entry.trustLevel || '').trim(),
    description: String(entry.description || '').trim(),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
    addedAt: String(entry.addedAt || '').trim() || nowIso(),
    updatedAt: String(entry.updatedAt || '').trim() || nowIso(),
    lastCheckedAt: String(entry.lastCheckedAt || '').trim(),
    lastError: String(entry.lastError || '').trim(),
    entryCount: Number.isFinite(entry.entryCount) ? entry.entryCount : 0,
    notes: String(entry.notes || '').trim(),
  };
}

function normalizeCatalogEntry(entry, source) {
  const sourceObject = entry.source && typeof entry.source === 'object' ? entry.source : {};
  const registrySourceId = source?.id || String(entry.registrySourceId || '').trim();
  const sourceLocation = source?.location || String(entry.registrySourceLocation || '').trim();
  const sourceLabel = source?.label || String(entry.registrySourceLabel || '').trim();
  return {
    id: String(entry.id || '').trim(),
    name: String(entry.name || '').trim(),
    version: String(entry.version || '').trim(),
    type: String(entry.type || '').trim(),
    author: String(entry.author || '').trim(),
    description: String(entry.description || '').trim(),
    source: {
      kind: String(sourceObject.kind || 'github').trim(),
      owner: String(sourceObject.owner || '').trim(),
      repo: String(sourceObject.repo || '').trim(),
      ref: String(sourceObject.ref || '').trim() || 'main',
      subdirectory: String(sourceObject.subdirectory || '').trim(),
      url: String(sourceObject.url || '').trim(),
    },
    manifestPath: String(entry.manifestPath || sourceObject.manifestPath || '').trim() || 'localcodex-extension.json',
    entryPaths: Array.isArray(entry.entryPaths) ? entry.entryPaths.map((item) => String(item).trim()).filter(Boolean) : [],
    capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map((item) => String(item).trim()).filter(Boolean) : [],
    compatibility: entry.compatibility || null,
    installNotes: String(entry.installNotes || '').trim(),
    localization: entry.localization || null,
    hashes: entry.hashes || null,
    publisher: String(entry.publisher || source?.publisher || '').trim(),
    reviewStatus: String(entry.reviewStatus || source?.reviewStatus || '').trim(),
    verifiedSource: typeof entry.verifiedSource === 'boolean' ? entry.verifiedSource : source?.verifiedSource ?? null,
    supportedAppVersions: Array.isArray(entry.supportedAppVersions) ? entry.supportedAppVersions.map((item) => String(item).trim()).filter(Boolean) : [],
    signature: String(entry.signature || '').trim(),
    trustLevel: String(entry.trustLevel || source?.trustLevel || '').trim(),
    recommended: typeof entry.recommended === 'boolean' ? entry.recommended : false,
    lastCheckedAt: String(entry.lastCheckedAt || source?.lastCheckedAt || '').trim(),
    validationStatus: String(entry.validationStatus || '').trim(),
    validationIssues: Array.isArray(entry.validationIssues) ? entry.validationIssues.map(String) : [],
    registrySourceId,
    registrySourceLabel: sourceLabel,
    registrySourceLocation: sourceLocation,
    registrySourceEnabled: source?.enabled !== false,
    registryEntryId: String(entry.registryEntryId || '').trim(),
  };
}

function isValidCatalogShape(catalog) {
  return catalog && typeof catalog === 'object' && Array.isArray(catalog.entries || catalog.extensions || []);
}

function parseCatalogEntries(catalog) {
  return Array.isArray(catalog.entries)
    ? catalog.entries
    : Array.isArray(catalog.extensions)
      ? catalog.extensions
      : [];
}

function validateCatalogEntry(entry, source, appVersion) {
  const issues = [];
  const normalized = normalizeCatalogEntry(entry, source);
  if (!normalized.id) {
    issues.push('Manifest id обязателен.');
  }
  if (!normalized.name) {
    issues.push('Manifest name обязателен.');
  }
  if (!normalized.version) {
    issues.push('Manifest version обязателен.');
  }
  if (!normalized.type) {
    issues.push('Manifest type обязателен.');
  }
  if (!normalized.description) {
    issues.push('Manifest description обязателен.');
  }
  if (!normalized.manifestPath) {
    issues.push('Manifest path обязателен.');
  }
  if (!normalized.source.owner || !normalized.source.repo) {
    issues.push('Source GitHub repository is missing.');
  }
  if (normalized.reviewStatus && !REVIEW_STATUSES.has(normalized.reviewStatus)) {
    issues.push(`Неподдерживаемый reviewStatus: ${normalized.reviewStatus}`);
  }
  if (normalized.trustLevel && !TRUST_LEVELS.has(normalized.trustLevel)) {
    issues.push(`Неподдерживаемый trustLevel: ${normalized.trustLevel}`);
  }
  if (normalized.supportedAppVersions.length && appVersion && !normalized.supportedAppVersions.some((range) => satisfiesVersionRange(appVersion, range))) {
    issues.push(`Версия приложения ${appVersion} не входит в supportedAppVersions.`);
  }
  return { normalized, issues };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sourceFilePath(projectRoot, sourceId) {
  return path.join(normalizeRoot(projectRoot), REGISTRY_CACHE_DIR, `${sourceId}.json`);
}

function catalogCachePath(projectRoot, sourceId) {
  return path.join(normalizeRoot(projectRoot), REGISTRY_CACHE_DIR, `${sourceId}.validated.json`);
}

export function getRegistryWorkspacePaths(projectRoot) {
  const root = normalizeRoot(projectRoot);
  return {
    registryRoot: path.join(root, '.local-codex', 'extensions'),
    sourcesPath: path.join(root, REGISTRY_SOURCES_PATH),
    catalogPath: path.join(root, REGISTRY_CATALOG_PATH),
    cacheRoot: path.join(root, REGISTRY_CACHE_DIR),
    curatedRegistryPath: path.join(root, CURATED_REGISTRY_FILE),
  };
}

export async function ensureRegistryWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const paths = getRegistryWorkspacePaths(root);
  await ensureDirectory(paths.registryRoot);
  await ensureDirectory(paths.cacheRoot);
  if (!(await fileExists(paths.sourcesPath))) {
    await writeJson(paths.sourcesPath, defaultRegistrySources());
  }
  if (!(await fileExists(paths.catalogPath))) {
    await writeJson(paths.catalogPath, defaultRegistryCatalog());
  }
  return paths;
}

export async function readRegistrySources(projectRoot) {
  const paths = await ensureRegistryWorkspace(projectRoot);
  return (await readJson(paths.sourcesPath)) || defaultRegistrySources();
}

export async function writeRegistrySources(projectRoot, data) {
  const paths = await ensureRegistryWorkspace(projectRoot);
  await writeJson(paths.sourcesPath, data);
  return data;
}

export async function readRegistryCatalog(projectRoot) {
  const paths = await ensureRegistryWorkspace(projectRoot);
  return (await readJson(paths.catalogPath)) || defaultRegistryCatalog();
}

export async function writeRegistryCatalog(projectRoot, data) {
  const paths = await ensureRegistryWorkspace(projectRoot);
  await writeJson(paths.catalogPath, data);
  return data;
}

export function normalizeRegistrySourceDescriptor(input, projectRoot) {
  const { kind, location, raw } = normalizeLocation(input, projectRoot);
  return {
    id: sourceIdForLocation(location),
    kind,
    location,
    raw,
    label: defaultSourceLabel(location),
    enabled: true,
    publisher: '',
    reviewStatus: '',
    verifiedSource: null,
    trustLevel: '',
    description: '',
    addedAt: nowIso(),
    updatedAt: nowIso(),
    lastCheckedAt: '',
    lastError: '',
    entryCount: 0,
    notes: '',
  };
}

async function readSourceCatalog(location) {
  if (isHttpUrl(location)) {
    const response = await fetch(location, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'localcodex-registry-client',
      },
    });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить registry source: HTTP ${response.status}`);
    }
    const text = await response.text();
    return { text, parsed: JSON.parse(text) };
  }
  const text = await fs.readFile(location, 'utf8');
  return { text, parsed: JSON.parse(text) };
}

function mergeCatalogSourceDefaults(source, catalog) {
  return {
    ...source,
    label: String(catalog.name || source.label || '').trim() || source.label,
    publisher: String(catalog.publisher || source.publisher || '').trim(),
    reviewStatus: String(catalog.reviewStatus || source.reviewStatus || '').trim(),
    verifiedSource: typeof catalog.verifiedSource === 'boolean' ? catalog.verifiedSource : source.verifiedSource,
    trustLevel: String(catalog.trustLevel || source.trustLevel || '').trim(),
    description: String(catalog.description || source.description || '').trim(),
  };
}

function buildValidationIssue(source, message, severity = 'error') {
  return {
    id: source?.id || 'unknown',
    sourceId: source?.id || null,
    severity,
    message,
  };
}

export async function addRegistrySource(projectRoot, input, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensureRegistryWorkspace(root);
  const descriptor = normalizeRegistrySourceDescriptor(input, root);
  const sources = await readRegistrySources(root);
  const list = Array.isArray(sources.sources) ? sources.sources : [];
  if (list.some((source) => source.id === descriptor.id || source.location === descriptor.location)) {
    return {
      added: false,
      source: list.find((source) => source.id === descriptor.id || source.location === descriptor.location),
    };
  }
  const source = normalizeSourceEntry({
    ...descriptor,
    label: options.label || descriptor.label,
    publisher: options.publisher || '',
    reviewStatus: options.reviewStatus || '',
    verifiedSource: typeof options.verifiedSource === 'boolean' ? options.verifiedSource : null,
    trustLevel: options.trustLevel || '',
    description: options.description || '',
    notes: options.notes || '',
  });
  const next = {
    ...sources,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    sources: [...list, source],
  };
  await writeRegistrySources(root, next);
  return { added: true, source };
}

export async function removeRegistrySource(projectRoot, idOrLocation) {
  const root = normalizeRoot(projectRoot);
  await ensureRegistryWorkspace(root);
  const needle = String(idOrLocation || '').trim();
  const sources = await readRegistrySources(root);
  const list = Array.isArray(sources.sources) ? sources.sources : [];
  const nextSources = list.filter((source) => source.id !== needle && source.location !== needle);
  const removed = nextSources.length !== list.length;
  if (removed) {
    await writeRegistrySources(root, {
      ...sources,
      updatedAt: nowIso(),
      sources: nextSources,
    });
  }
  return { removed, sources: nextSources };
}

export async function listRegistrySources(projectRoot) {
  const sources = await readRegistrySources(projectRoot);
  return Array.isArray(sources.sources) ? sources.sources.map(normalizeSourceEntry) : [];
}

async function loadSourceEntries(projectRoot, sourceDescriptor) {
  const location = sourceDescriptor.location;
  const cachedPath = sourceFilePath(projectRoot, sourceDescriptor.id);
  const { text, parsed } = await readSourceCatalog(location);
  await writeJson(cachedPath, {
    fetchedAt: nowIso(),
    location,
    parsed,
  });
  const catalog = isValidCatalogShape(parsed) ? parsed : null;
  if (!catalog) {
    throw new Error(`Недопустимый формат registry source: ${location}`);
  }
  const normalizedSource = mergeCatalogSourceDefaults(sourceDescriptor, catalog);
  const entries = parseCatalogEntries(catalog);
  return {
    source: normalizedSource,
    entries,
    rawText: text,
  };
}

export async function refreshRegistryCatalog(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureRegistryWorkspace(root);
  const appVersion = (await readJson(path.join(root, 'package.json')))?.version || '0.0.0';
  const sourcesFile = await readRegistrySources(root);
  const sourceList = Array.isArray(sourcesFile.sources) ? sourcesFile.sources.map(normalizeSourceEntry) : [];
  const catalogEntries = [];
  const issues = [];
  const refreshedSources = [];

  for (const source of sourceList) {
    if (!source.enabled) {
      issues.push(buildValidationIssue(source, 'Источник каталога отключен.', 'warning'));
      refreshedSources.push({ ...source, updatedAt: nowIso(), lastError: 'disabled' });
      continue;
    }
    try {
      const loaded = await loadSourceEntries(root, source);
      const validatedEntries = [];
      for (const entry of loaded.entries) {
        const validation = validateCatalogEntry(entry, loaded.source, appVersion);
        const preview = await previewExtensionInstall(root, validation.normalized.source, {
          path: validation.normalized.source.subdirectory,
          ref: validation.normalized.source.ref,
          manifestPath: validation.normalized.manifestPath,
        }).catch((error) => ({
          ok: false,
          issues: [error instanceof Error ? error.message : String(error)],
        }));

        const validationIssues = [...validation.issues];
        if (!preview.ok) {
          validationIssues.push(...preview.issues);
        } else {
          if (preview.manifest.id !== validation.normalized.id) {
            validationIssues.push(`Manifest id не совпадает: ${preview.manifest.id} != ${validation.normalized.id}`);
          }
          if (preview.manifest.version !== validation.normalized.version) {
            validationIssues.push(`Manifest version не совпадает: ${preview.manifest.version} != ${validation.normalized.version}`);
          }
          if (preview.manifest.type !== validation.normalized.type) {
            validationIssues.push(`Manifest type не совпадает: ${preview.manifest.type} != ${validation.normalized.type}`);
          }
        }

        const normalizedEntry = normalizeCatalogEntry({
          ...validation.normalized,
          validationStatus: validationIssues.length ? 'warning' : 'valid',
          validationIssues,
          lastCheckedAt: nowIso(),
        }, loaded.source);

        if (validationIssues.length) {
          issues.push({
            id: normalizedEntry.id,
            sourceId: loaded.source.id,
            severity: 'warning',
            message: validationIssues.join('; '),
          });
        }
        validatedEntries.push(normalizedEntry);
      }
      catalogEntries.push(...validatedEntries);
      refreshedSources.push({
        ...loaded.source,
        updatedAt: nowIso(),
        lastCheckedAt: nowIso(),
        lastError: '',
        entryCount: validatedEntries.length,
      });
      await atomicWriteFile(catalogCachePath(root, loaded.source.id), `${JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        source: loaded.source,
        entries: validatedEntries,
        generatedAt: nowIso(),
      }, null, 2)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(buildValidationIssue(source, message, 'error'));
      refreshedSources.push({
        ...source,
        updatedAt: nowIso(),
        lastCheckedAt: nowIso(),
        lastError: message,
      });
    }
  }

  const catalog = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    createdAt: sourcesFile.createdAt || nowIso(),
    updatedAt: nowIso(),
    sources: refreshedSources,
    entries: catalogEntries.sort((a, b) => a.name.localeCompare(b.name)),
    issues,
  };
  await writeRegistryCatalog(root, catalog);
  await writeRegistrySources(root, {
    ...sourcesFile,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    sources: refreshedSources,
  });
  return catalog;
}

export async function listRegistryEntries(projectRoot) {
  const catalog = await readRegistryCatalog(projectRoot);
  return Array.isArray(catalog.entries) ? catalog.entries.map((entry) => normalizeCatalogEntry(entry, {
    id: entry.registrySourceId,
    label: entry.registrySourceLabel,
    location: entry.registrySourceLocation,
    enabled: entry.registrySourceEnabled,
  })) : [];
}

export async function getRegistryEntry(projectRoot, entryId) {
  const needle = String(entryId || '').trim();
  const entries = await listRegistryEntries(projectRoot);
  return entries.find((entry) => entry.id === needle) || null;
}

export async function installRegistryEntry(projectRoot, entryId, options = {}) {
  const root = normalizeRoot(projectRoot);
  await ensureRegistryWorkspace(root);
  let entry = await getRegistryEntry(root, entryId);
  if (!entry) {
    await refreshRegistryCatalog(root);
    entry = await getRegistryEntry(root, entryId);
  }
  if (!entry) {
    throw new Error(`Запись каталога не найдена: ${entryId}`);
  }
  if (entry.registrySourceEnabled === false) {
    throw new Error(`Источник каталога отключен: ${entry.registrySourceId || entry.registrySourceLocation || 'unknown'}`);
  }
  const preview = await previewExtensionInstall(root, entry.source, {
    path: entry.source.subdirectory,
    ref: entry.source.ref,
    manifestPath: entry.manifestPath,
  });
  if (!preview.ok) {
    throw new Error(preview.issues.join('; '));
  }
  const result = await installExtension(root, entry.source, {
    ...options,
    path: entry.source.subdirectory,
    ref: entry.source.ref,
    manifestPath: entry.manifestPath,
    confirm: true,
    installSourceType: 'registry',
    publisher: entry.publisher,
    reviewStatus: entry.reviewStatus,
    verifiedSource: entry.verifiedSource,
    supportedAppVersions: entry.supportedAppVersions,
    signature: entry.signature,
    trustLevel: entry.trustLevel,
    recommended: entry.recommended,
    registrySourceId: entry.registrySourceId,
    registrySourceLabel: entry.registrySourceLabel,
    registrySourceLocation: entry.registrySourceLocation,
    registryEntryId: entry.id,
    lastCheckedAt: entry.lastCheckedAt || nowIso(),
    sourcePreview: preview,
  });
  return {
    ...result,
    registryEntry: {
      ...result.registryEntry,
      installSourceType: 'registry',
      registrySourceId: entry.registrySourceId,
      registrySourceLabel: entry.registrySourceLabel,
      registrySourceLocation: entry.registrySourceLocation,
      registryEntryId: entry.id,
      publisher: entry.publisher,
      reviewStatus: entry.reviewStatus,
      verifiedSource: entry.verifiedSource,
      supportedAppVersions: entry.supportedAppVersions,
      signature: entry.signature,
      trustLevel: entry.trustLevel,
      recommended: entry.recommended,
      lastCheckedAt: entry.lastCheckedAt || nowIso(),
    },
    sourcePreview: preview,
  };
}

export async function doctorRegistryCatalog(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureRegistryWorkspace(root);
  const sources = await readRegistrySources(root);
  const catalog = await readRegistryCatalog(root);
  const sourceList = Array.isArray(sources.sources) ? sources.sources.map(normalizeSourceEntry) : [];
  const catalogEntries = Array.isArray(catalog.entries) ? catalog.entries.map((entry) => normalizeCatalogEntry(entry, {
    id: entry.registrySourceId,
    label: entry.registrySourceLabel,
    location: entry.registrySourceLocation,
    enabled: entry.registrySourceEnabled,
  })) : [];
  const issues = [...(Array.isArray(catalog.issues) ? catalog.issues : [])];
  const enabledSourceIds = new Set(sourceList.filter((source) => source.enabled).map((source) => source.id));
  const sourceMap = new Map(sourceList.map((source) => [source.id, source]));
  const appVersion = (await readJson(path.join(root, 'package.json')))?.version || '0.0.0';

  for (const source of sourceList) {
    if (!source.enabled) {
      issues.push(buildValidationIssue(source, 'Источник каталога отключен.', 'warning'));
    }
    if (!source.location) {
      issues.push(buildValidationIssue(source, 'У источника отсутствует location.', 'error'));
    }
  }

  for (const entry of catalogEntries) {
    if (!enabledSourceIds.has(entry.registrySourceId)) {
      issues.push({
        id: entry.id,
        sourceId: entry.registrySourceId,
        severity: 'warning',
        message: 'Запись каталога ссылается на отключенный или отсутствующий источник.',
      });
    }
    if (entry.registrySourceId && !sourceMap.has(entry.registrySourceId)) {
      issues.push({
        id: entry.id,
        sourceId: entry.registrySourceId,
        severity: 'warning',
        message: 'Источник каталога удален или не найден.',
      });
    }
    if (entry.validationStatus && entry.validationStatus !== 'valid') {
      issues.push({
        id: entry.id,
        sourceId: entry.registrySourceId,
        severity: 'warning',
        message: `Статус проверки записи: ${entry.validationStatus}`,
      });
    }
    if (entry.lastCheckedAt) {
      const age = Date.now() - new Date(entry.lastCheckedAt).getTime();
      if (Number.isFinite(age) && age > 30 * 24 * 60 * 60 * 1000) {
        issues.push({
          id: entry.id,
          sourceId: entry.registrySourceId,
          severity: 'warning',
          message: 'Запись каталога устарела и давно не проверялась.',
        });
      }
    }
    if (entry.supportedAppVersions.length && appVersion && !entry.supportedAppVersions.some((range) => satisfiesVersionRange(appVersion, range))) {
      issues.push({
        id: entry.id,
        sourceId: entry.registrySourceId,
        severity: 'warning',
        message: `Версия приложения ${appVersion} не входит в supportedAppVersions.`,
      });
    }
  }

  return {
    sources: sourceList,
    catalog: catalogEntries,
    issues,
    healthy: issues.filter((issue) => issue.severity === 'error').length === 0,
  };
}

export function formatRegistryEntrySummary(entry) {
  const trust = [
    entry.reviewStatus ? `review:${entry.reviewStatus}` : null,
    entry.trustLevel ? `trust:${entry.trustLevel}` : null,
    entry.verifiedSource === true ? 'verified' : entry.verifiedSource === false ? 'unverified' : null,
  ].filter(Boolean);
  const sourceLabel = entry.registrySourceLabel || entry.registrySourceLocation || 'registry';
  return [
    `${entry.recommended ? '[recommended]' : ''}${entry.name} (${entry.id})`.trim(),
    `  type: ${entry.type}`,
    `  version: ${entry.version}`,
    `  publisher: ${entry.publisher || '-'}`,
    `  trust: ${trust.join(', ') || '-'}`,
    `  source: ${sourceLabel}`,
    `  capabilities: ${(entry.capabilities || []).join(', ') || '-'}`,
    `  path: ${entry.manifestPath || '-'}`,
  ].join('\n');
}

export function formatRegistrySourceSummary(source) {
  return [
    `${source.enabled ? '[enabled]' : '[disabled]'} ${source.label || source.location}`,
    `  id: ${source.id}`,
    `  location: ${source.location}`,
    `  review: ${source.reviewStatus || '-'}`,
    `  trust: ${source.trustLevel || '-'}`,
    `  verified: ${source.verifiedSource === true ? 'yes' : source.verifiedSource === false ? 'no' : '-'}`,
    `  entries: ${source.entryCount || 0}`,
  ].join('\n');
}

export async function getRegistryCatalog(projectRoot) {
  const catalog = await readRegistryCatalog(projectRoot);
  const sources = await readRegistrySources(projectRoot);
  return {
    sources: Array.isArray(sources.sources) ? sources.sources.map(normalizeSourceEntry) : [],
    entries: Array.isArray(catalog.entries) ? catalog.entries.map((entry) => normalizeCatalogEntry(entry, {
      id: entry.registrySourceId,
      label: entry.registrySourceLabel,
      location: entry.registrySourceLocation,
      enabled: entry.registrySourceEnabled,
    })) : [],
    issues: Array.isArray(catalog.issues) ? catalog.issues : [],
    updatedAt: catalog.updatedAt || '',
  };
}

export function getRegistryCatalogPath(projectRoot) {
  return getRegistryWorkspacePaths(projectRoot).catalogPath;
}

export function getRegistrySourcesPath(projectRoot) {
  return getRegistryWorkspacePaths(projectRoot).sourcesPath;
}
