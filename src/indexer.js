import fs from 'node:fs/promises';
import path from 'node:path';
import { emitter } from './events.js';
import { normalizeRoot } from './security.js';
import { readProjectPolicy } from './policy.js';
import { getEmbeddingProvider, embed as embedTexts } from './embeddings.js';
import { clearTable, createChunkId, deleteByPath, dropTable, openTable, tableInfo, upsertChunks, getVectorIndexRootPath } from './vectordb.js';

const MEMORY_TABLE = 'memory';
const CODE_TABLE = 'code';
const MAX_CODE_FILE_SIZE = 500 * 1024;
const MEMORY_MIN_CHUNK_CHARS = 50;
const CODE_LONG_CHUNK_LIMIT = 1500;
const CODE_SPLIT_CHUNK_SIZE = 800;
const CODE_SPLIT_OVERLAP = 100;
const CODE_CONTEXT_LINES = 2;

const MEMORY_EXCLUDED_PATHS = [
  '.local-codex/vector-index/',
  '.local-codex/events.jsonl',
  '.local-codex/stats.json',
  '.local-codex/token-usage.jsonl',
  '.local-codex/budget-cache.json',
  '.local-codex/test-runs.jsonl',
  '.local-codex/test-runs/',
  '.local-codex/hook-history.jsonl',
  '.local-codex/hook-errors.log',
  '.local-codex/server.pid',
];

const CODE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.swift', '.py']);
const DEFAULT_CODE_EXCLUDES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'coverage/',
  '*.min.js',
  '*.lock',
  '*.jsonl',
  '*.md',
];

function nowIso() {
  return new Date().toISOString();
}

function normalizePosix(value) {
  return String(value || '').replaceAll(path.sep, '/');
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function walkFiles(root, visitor, relativeDir = '') {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      const shouldDescend = await visitor(relativePath, entry, true);
      if (shouldDescend === false) {
        continue;
      }
      await walkFiles(root, visitor, relativePath);
      continue;
    }
    await visitor(relativePath, entry, false);
  }
}

function isMemoryExcluded(relativePath) {
  const normalized = normalizePosix(relativePath);
  return MEMORY_EXCLUDED_PATHS.some((pattern) => normalized.startsWith(pattern) || normalized.includes(pattern));
}

function matchGlob(value, pattern) {
  const target = normalizePosix(value);
  const normalizedPattern = normalizePosix(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern === target) {
    return true;
  }
  if (normalizedPattern.endsWith('/')) {
    return target === normalizedPattern.slice(0, -1) || target.startsWith(normalizedPattern);
  }
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.startsWith('**/')) {
    return target.endsWith(normalizedPattern.slice(3));
  }
  if (normalizedPattern.startsWith('*')) {
    return target.endsWith(normalizedPattern.slice(1));
  }
  if (normalizedPattern.includes('*')) {
    const escaped = normalizedPattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${escaped}$`).test(target);
  }
  return target.startsWith(`${normalizedPattern}/`) || target === normalizedPattern;
}

async function loadIgnorePatterns(projectRoot, policy) {
  const patterns = new Set(DEFAULT_CODE_EXCLUDES);
  const gitignore = await readTextFile(path.join(projectRoot, '.gitignore'), '');
  for (const line of gitignore.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    patterns.add(trimmed);
  }
  for (const pattern of policy?.vectorIndex?.excludePatterns || []) {
    patterns.add(pattern);
  }
  return [...patterns];
}

function isCodeExcluded(relativePath, patterns) {
  const normalized = normalizePosix(relativePath);
  if (!normalized) {
    return true;
  }
  const basename = path.posix.basename(normalized);
  if (basename.startsWith('.git') || basename === '.DS_Store') {
    return true;
  }
  return patterns.some((pattern) => matchGlob(normalized, pattern) || matchGlob(basename, pattern));
}

function inferMemoryMetadata(relativePath) {
  const normalized = normalizePosix(relativePath);
  const lower = normalized.toLowerCase();
  if (lower.includes('/tasks/') || lower.endsWith('task.json')) {
    return { type: 'task', title: path.basename(normalized, path.extname(normalized)), tags: [] };
  }
  if (lower.includes('/decisions') || lower.includes('decisions')) {
    return { type: 'decision', title: path.basename(normalized, path.extname(normalized)), tags: [] };
  }
  if (lower.includes('/notes/')) {
    return { type: 'note', title: path.basename(normalized, path.extname(normalized)), tags: [] };
  }
  return { type: 'doc', title: path.basename(normalized, path.extname(normalized)), tags: [] };
}

function inferCodeMetadata(relativePath, content) {
  const ext = path.extname(relativePath).toLowerCase();
  const lines = String(content || '').replaceAll('\r\n', '\n').split('\n');
  const firstSymbolLine = lines.findIndex((line) => /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+\w+|(?:^|\s)(?:export\s+)?class\s+\w+|(?:^|\s)(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function|\()/i.test(line.trim()));
  let symbolType = null;
  let symbolName = null;
  if (firstSymbolLine >= 0) {
    const line = lines[firstSymbolLine].trim();
    const functionMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/i);
    const classMatch = line.match(/(?:export\s+)?class\s+([A-Za-z0-9_$]+)/i);
    const exportMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function|\()/i);
    if (functionMatch) {
      symbolType = 'function';
      symbolName = functionMatch[1];
    } else if (classMatch) {
      symbolType = 'class';
      symbolName = classMatch[1];
    } else if (exportMatch) {
      symbolType = 'export';
      symbolName = exportMatch[1];
    }
  }
  return {
    language: ext.replace('.', '') || 'text',
    symbolType,
    symbolName,
  };
}

function splitLongText(content, limit = CODE_SPLIT_CHUNK_SIZE, overlap = CODE_SPLIT_OVERLAP) {
  const text = String(content || '');
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const next = Math.min(text.length, offset + limit);
    chunks.push(text.slice(offset, next));
    if (next >= text.length) {
      break;
    }
    offset = Math.max(0, next - overlap);
  }
  return chunks.filter((chunk) => chunk.trim().length >= MEMORY_MIN_CHUNK_CHARS);
}

function chunkMarkdown(content) {
  const text = String(content || '').replaceAll('\r\n', '\n');
  const lines = text.split('\n');
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line.trim()) && current.length) {
      sections.push(current.join('\n').trim());
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) {
    sections.push(current.join('\n').trim());
  }
  const chunks = [];
  for (const section of sections) {
    if (section.length < MEMORY_MIN_CHUNK_CHARS) {
      continue;
    }
    if (estimateTokens(section) > 1000) {
      const paragraphs = section.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
      let buffer = [];
      let bufferLength = 0;
      for (const paragraph of paragraphs) {
        if (bufferLength + paragraph.length > 4000 && buffer.length) {
          chunks.push(buffer.join('\n\n').trim());
          buffer = [paragraph];
          bufferLength = paragraph.length;
          continue;
        }
        buffer.push(paragraph);
        bufferLength += paragraph.length;
      }
      if (buffer.length) {
        chunks.push(buffer.join('\n\n').trim());
      }
      continue;
    }
    chunks.push(section);
  }
  return chunks.filter((chunk) => chunk.length >= MEMORY_MIN_CHUNK_CHARS);
}

function chunkJson(content) {
  try {
    const parsed = JSON.parse(String(content || '{}'));
    if (parsed && typeof parsed === 'object') {
      return [JSON.stringify(parsed, null, 2)];
    }
  } catch {
    // Fall through to raw text.
  }
  return [String(content || '')];
}

function symbolStartLines(content, ext) {
  const lines = String(content || '').replaceAll('\r\n', '\n').split('\n');
  const starts = [0];
  const patterns = {
    '.js': /^(?:export\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?class\s+\w+|^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function|\()/,
    '.ts': /^(?:export\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?class\s+\w+|^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function|\()/,
    '.mjs': /^(?:export\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?class\s+\w+|^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function|\()/,
    '.swift': /^(?:public\s+|private\s+|internal\s+|fileprivate\s+)?(?:async\s+)?(?:func|class|struct|extension)\s+\w+/,
    '.py': /^(?:async\s+def|def|class)\s+\w+/,
  };
  const matcher = patterns[ext] || patterns['.js'];
  for (let index = 0; index < lines.length; index += 1) {
    if (index === 0) {
      continue;
    }
    if (matcher.test(lines[index].trim())) {
      starts.push(index);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

function chunkCode(content, relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  const lines = String(content || '').replaceAll('\r\n', '\n').split('\n');
  const starts = symbolStartLines(content, ext);
  if (starts.length <= 1) {
    return [String(content || '')];
  }
  const chunks = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = Math.max(0, starts[index] - CODE_CONTEXT_LINES);
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const section = lines.slice(start, end).join('\n').trim();
    if (!section) {
      continue;
    }
    if (section.length > CODE_LONG_CHUNK_LIMIT) {
      chunks.push(...splitLongText(section, CODE_SPLIT_CHUNK_SIZE, CODE_SPLIT_OVERLAP));
      continue;
    }
    chunks.push(section);
  }
  return chunks.filter((chunk) => chunk.length >= MEMORY_MIN_CHUNK_CHARS);
}

function createChunkRecord({ source, filePath, chunkIndex, content, vector, metadata, updatedAt, sourceMtimeMs, embeddingModel, dimensions }) {
  return {
    id: createChunkId(filePath, chunkIndex),
    source,
    filePath,
    chunkIndex,
    content,
    vector,
    metadata: JSON.stringify(metadata || {}),
    updatedAt,
    sourceMtimeMs,
    embeddingModel,
    dimensions,
  };
}

async function ensureCompatibleTable(table, embeddingProvider, force = false) {
  const info = await tableInfo(table);
  if (force || !info.embeddingModel || !info.dimensions) {
    return info;
  }
  const embeddingModel = embeddingProvider?.model || null;
  const dimensions = Number(embeddingProvider?.dimensions) || null;
  if ((embeddingModel && info.embeddingModel !== embeddingModel) || (dimensions && info.dimensions !== dimensions)) {
    const error = new Error(`Индекс ${table.tableName} использует ${info.embeddingModel}/${info.dimensions}, а текущий embedding provider — ${embeddingModel}/${dimensions}. Нужен rebuild.`);
    error.code = 'index_mismatch';
    error.info = info;
    throw error;
  }
  return info;
}

async function loadCandidateFiles(projectRoot, target, patterns, options = {}) {
  const root = normalizeRoot(projectRoot);
  const files = [];
  const memoryRoot = path.join(root, '.local-codex');
  const codeRoots = [
    path.join(root, 'src'),
    path.join(root, 'test'),
    path.join(root, 'macos'),
    path.join(root, 'scripts'),
  ];
  const includeMemory = target === 'memory' || target === 'all';
  const includeCode = target === 'code' || target === 'all';
  const includeExtensions = new Set((options.codeExtensions || ['.js', '.ts', '.mjs', '.swift', '.py']).map((ext) => String(ext).toLowerCase()));

  if (includeMemory) {
    await walkFiles(memoryRoot, async (relativePath, entry, isDirectory) => {
      if (isDirectory) {
        if (normalizePosix(relativePath) === '.local-codex/vector-index') {
          return;
        }
        return;
      }
      const normalized = normalizePosix(relativePath);
      if (isMemoryExcluded(normalized)) {
        return;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.md', '.json', '.txt'].includes(ext)) {
        return;
      }
      files.push({ source: 'memory', path: normalized, absolutePath: path.join(memoryRoot, relativePath) });
    });
  }

  if (includeCode) {
    for (const codeRoot of codeRoots) {
      if (!(await fileExists(codeRoot))) {
        continue;
      }
      await walkFiles(codeRoot, async (relativePath, entry, isDirectory) => {
        if (isDirectory) {
          return;
        }
        const normalized = normalizePosix(path.join(path.relative(root, codeRoot), relativePath));
        const ext = path.extname(entry.name).toLowerCase();
        if (!includeExtensions.has(ext)) {
          return;
        }
        if (isCodeExcluded(normalized, patterns)) {
          return;
        }
        const stat = await statIfExists(path.join(codeRoot, relativePath));
        if (stat && stat.size > MAX_CODE_FILE_SIZE) {
          return;
        }
        files.push({ source: 'code', path: normalized, absolutePath: path.join(codeRoot, relativePath), mtimeMs: stat?.mtimeMs || null });
      });
    }
  }

  return files;
}

async function indexFile({ table, source, file, embeddingProvider, force = false }) {
  const content = await readTextFile(file.absolutePath, '');
  if (!content.trim()) {
    return { chunksAdded: 0, chunksUpdated: 0, skipped: 1 };
  }
  const updatedAt = nowIso();
  const mtimeMs = file.mtimeMs || (await statIfExists(file.absolutePath))?.mtimeMs || null;
  const ext = path.extname(file.path).toLowerCase();
  const chunks = source === 'memory'
    ? (ext === '.json' ? chunkJson(content) : chunkMarkdown(content))
    : chunkCode(content, file.path);
  const filtered = chunks.filter((chunk) => String(chunk || '').trim().length >= MEMORY_MIN_CHUNK_CHARS);
  if (!filtered.length) {
    return { chunksAdded: 0, chunksUpdated: 0, skipped: 1 };
  }
  const vectors = await embedTexts(filtered, embeddingProvider, { projectRoot: table.projectRoot });
  const records = filtered.map((chunk, index) => createChunkRecord({
    source,
    filePath: file.path,
    chunkIndex: index,
    content: chunk,
    vector: vectors[index],
    metadata: source === 'memory'
      ? inferMemoryMetadata(file.path)
      : inferCodeMetadata(file.path, content),
    updatedAt,
    sourceMtimeMs: mtimeMs,
    embeddingModel: embeddingProvider.model,
    dimensions: embeddingProvider.dimensions,
  }));
  if (force) {
    await deleteByPath(table, file.path);
  }
  await upsertChunks(table, records);
  return {
    chunksAdded: records.length,
    chunksUpdated: force ? records.length : 0,
    skipped: 0,
  };
}

async function getTableWithInfo(projectRoot, tableName, embeddingProvider, force = false) {
  const table = await openTable(projectRoot, tableName, {
    embeddingModel: embeddingProvider?.model || null,
    dimensions: embeddingProvider?.dimensions || null,
  });
  await ensureCompatibleTable(table, embeddingProvider, force);
  return table;
}

async function indexTarget(projectRoot, policy, embeddingProvider, target, { force = false, incremental = false } = {}) {
  const root = normalizeRoot(projectRoot);
  const patterns = await loadIgnorePatterns(root, policy);
  const files = await loadCandidateFiles(root, target, patterns, policy?.vectorIndex || {});
  const tableName = target === 'code' ? CODE_TABLE : MEMORY_TABLE;
  const table = await getTableWithInfo(root, tableName, embeddingProvider, force);

  try {
    let existing = [];
    if (incremental) {
      existing = (await tableInfo(table)).totalChunks ? (await readTableRows(table)) : [];
    } else {
      await clearTable(table);
    }
    const existingByPath = new Map();
    for (const row of existing) {
      const list = existingByPath.get(row.filePath) || [];
      list.push(row);
      existingByPath.set(row.filePath, list);
    }

    const stats = {
      filesProcessed: 0,
      chunksAdded: 0,
      chunksUpdated: 0,
      chunksDeleted: 0,
      skipped: 0,
      durationMs: 0,
    };
    const startedAt = Date.now();
    emitter.emit('index:start', {
      projectRoot: root,
      target,
      totalFiles: files.length,
    });

    const seenPaths = new Set();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      seenPaths.add(file.path);
      stats.filesProcessed += 1;
      if (incremental) {
        const fileStat = await statIfExists(file.absolutePath);
        if (!fileStat) {
          await deleteByPath(table, file.path);
          stats.chunksDeleted += (existingByPath.get(file.path) || []).length;
          emitter.emit('index:progress', {
            projectRoot: root,
            target,
            filesProcessed: stats.filesProcessed,
            totalFiles: files.length,
            chunksAdded: stats.chunksAdded,
          });
          continue;
        }
        const previous = existingByPath.get(file.path) || [];
        const latestMtime = Math.max(...previous.map((row) => Number(row.sourceMtimeMs) || 0), 0);
        if (latestMtime && fileStat.mtimeMs <= latestMtime) {
          stats.skipped += 1;
          emitter.emit('index:progress', {
            projectRoot: root,
            target,
            filesProcessed: stats.filesProcessed,
            totalFiles: files.length,
            chunksAdded: stats.chunksAdded,
          });
          continue;
        }
        await deleteByPath(table, file.path);
      }
      const result = await indexFile({
        table,
        source: target === 'code' ? 'code' : 'memory',
        file,
        embeddingProvider,
        force: force || incremental,
      });
      stats.chunksAdded += result.chunksAdded;
      stats.chunksUpdated += result.chunksUpdated;
      stats.skipped += result.skipped;
      emitter.emit('index:progress', {
        projectRoot: root,
        target,
        filesProcessed: stats.filesProcessed,
        totalFiles: files.length,
        chunksAdded: stats.chunksAdded,
      });
    }

    if (incremental) {
      const stale = (await readTableRows(table)).filter((row) => !seenPaths.has(row.filePath));
      for (const row of stale) {
        await deleteByPath(table, row.filePath);
        stats.chunksDeleted += 1;
      }
    }

    stats.durationMs = Date.now() - startedAt;
    const info = await tableInfo(table);
    emitter.emit('index:done', {
      projectRoot: root,
      target,
      stats,
      table: info,
    });
    try {
      const { runExtensionHook } = await import('./extensions.js');
      await runExtensionHook(root, 'index-update', {
        target,
        stats,
      }, {
        policy,
      }).catch(() => {});
    } catch {
      // Extension hooks are best-effort.
    }
    return stats;
  } catch (error) {
    emitter.emit('index:error', {
      projectRoot: root,
      target,
      error: error?.message || String(error),
    });
    throw error;
  }
}

async function readTableRows(table) {
  const tableState = await readJsonFile(table.tablePath, { rows: [] });
  return Array.isArray(tableState.rows) ? tableState.rows : [];
}

async function directorySize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      return stat.size;
    }
    if (!stat.isDirectory()) {
      return 0;
    }
    const entries = await fs.readdir(filePath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      total += await directorySize(path.join(filePath, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

export async function indexMemory(projectRoot, policy, embeddingProvider, options = {}) {
  return indexTarget(projectRoot, policy, embeddingProvider, 'memory', options);
}

export async function indexCode(projectRoot, policy, embeddingProvider, options = {}) {
  return indexTarget(projectRoot, policy, embeddingProvider, 'code', options);
}

export async function indexAll(projectRoot, policy, embeddingProvider, options = {}) {
  const memoryStats = await indexMemory(projectRoot, policy, embeddingProvider, options);
  const codeStats = await indexCode(projectRoot, policy, embeddingProvider, options);
  return {
    filesProcessed: memoryStats.filesProcessed + codeStats.filesProcessed,
    chunksAdded: memoryStats.chunksAdded + codeStats.chunksAdded,
    chunksUpdated: memoryStats.chunksUpdated + codeStats.chunksUpdated,
    chunksDeleted: memoryStats.chunksDeleted + codeStats.chunksDeleted,
    skipped: memoryStats.skipped + codeStats.skipped,
    durationMs: memoryStats.durationMs + codeStats.durationMs,
  };
}

export async function indexIncremental(projectRoot, policy, embeddingProvider, options = {}) {
  const memoryStats = await indexMemory(projectRoot, policy, embeddingProvider, { ...options, incremental: true });
  const codeStats = await indexCode(projectRoot, policy, embeddingProvider, { ...options, incremental: true });
  return {
    filesProcessed: memoryStats.filesProcessed + codeStats.filesProcessed,
    chunksAdded: memoryStats.chunksAdded + codeStats.chunksAdded,
    chunksUpdated: memoryStats.chunksUpdated + codeStats.chunksUpdated,
    chunksDeleted: memoryStats.chunksDeleted + codeStats.chunksDeleted,
    skipped: memoryStats.skipped + codeStats.skipped,
    durationMs: memoryStats.durationMs + codeStats.durationMs,
  };
}

export async function dropIndex(projectRoot, target = 'all') {
  const root = normalizeRoot(projectRoot);
  if (target === 'memory' || target === 'all') {
    await dropTable(root, MEMORY_TABLE);
  }
  if (target === 'code' || target === 'all') {
    await dropTable(root, CODE_TABLE);
  }
}

export async function getIndexStatus(projectRoot, policy = null) {
  const root = normalizeRoot(projectRoot);
  const vectorIndex = policy?.vectorIndex || policy || {};
  const embeddingModel = vectorIndex.embeddingModel || null;
  const dimensions = Number.isFinite(Number(vectorIndex.dimensions)) ? Number(vectorIndex.dimensions) : null;
  const memory = await tableInfo(await openTable(root, MEMORY_TABLE, { embeddingModel, dimensions }));
  const code = await tableInfo(await openTable(root, CODE_TABLE, { embeddingModel, dimensions }));
  const indexRoot = getVectorIndexRootPath(root);
  const sizeBytes = await directorySize(indexRoot);
  return {
    embedding: {
      provider: vectorIndex.embeddingProvider || 'ollama',
      model: embeddingModel,
      dimensions,
    },
    tables: [memory, code],
    sizeBytes,
  };
}

export async function ensureIndexExists(projectRoot, target = 'all') {
  const root = normalizeRoot(projectRoot);
  const memoryPath = path.join(root, '.local-codex', 'vector-index', MEMORY_TABLE, TABLE_FILE_NAME);
  const codePath = path.join(root, '.local-codex', 'vector-index', CODE_TABLE, TABLE_FILE_NAME);
  if (target === 'memory') {
    return fileExists(memoryPath);
  }
  if (target === 'code') {
    return fileExists(codePath);
  }
  return (await fileExists(memoryPath)) || (await fileExists(codePath));
}

export async function prepareEmbeddingProvider(projectRoot, policy = null) {
  const resolvedPolicy = policy || await readProjectPolicy(projectRoot).catch(() => ({}));
  return getEmbeddingProvider({
    ...resolvedPolicy,
    projectRoot,
  });
}

export async function rebuildIndex(projectRoot, policy, embeddingProvider, target = 'all') {
  await dropIndex(projectRoot, target);
  if (target === 'memory') {
    return indexMemory(projectRoot, policy, embeddingProvider, { force: true });
  }
  if (target === 'code') {
    return indexCode(projectRoot, policy, embeddingProvider, { force: true });
  }
  return indexAll(projectRoot, policy, embeddingProvider, { force: true });
}
