import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createProviderError } from './providers/shared.js';
import { normalizeRoot } from './security.js';

const VECTOR_INDEX_DIR_NAME = path.join('.local-codex', 'vector-index');
const TABLE_FILE_NAME = 'table.json';
const VECTOR_INDEX_SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir(dirPath) {
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

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, encoding);
  await fs.rename(tempPath, filePath);
}

function normalizeTableName(name) {
  const value = String(name || '').trim();
  if (!value) {
    throw new Error('Не указано имя таблицы.');
  }
  return value;
}

function getVectorIndexRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), VECTOR_INDEX_DIR_NAME);
}

function getTableDir(projectRoot, tableName) {
  return path.join(getVectorIndexRoot(projectRoot), normalizeTableName(tableName));
}

function getTablePath(projectRoot, tableName) {
  return path.join(getTableDir(projectRoot, tableName), TABLE_FILE_NAME);
}

function defaultTableState(tableName) {
  return {
    version: VECTOR_INDEX_SCHEMA_VERSION,
    tableName,
    embeddingModel: null,
    dimensions: null,
    updatedAt: null,
    rows: [],
  };
}

function normalizeVector(vector) {
  if (vector instanceof Float32Array) {
    return Array.from(vector);
  }
  if (Array.isArray(vector)) {
    return vector.map((value) => Number(value) || 0);
  }
  return [];
}

function parseMetadata(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

async function readTableState(table) {
  const state = await readJsonFile(table.tablePath, null);
  if (!state) {
    return defaultTableState(table.tableName);
  }
  return {
    ...defaultTableState(table.tableName),
    ...state,
    rows: Array.isArray(state.rows) ? state.rows : [],
  };
}

async function writeTableState(table, state) {
  await ensureDir(path.dirname(table.tablePath));
  const next = {
    ...defaultTableState(table.tableName),
    ...state,
    rows: Array.isArray(state.rows) ? state.rows : [],
    updatedAt: state.updatedAt || nowIso(),
  };
  await atomicWriteFile(table.tablePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function openTable(projectRoot, tableName, options = {}) {
  const root = normalizeRoot(projectRoot);
  const name = normalizeTableName(tableName);
  const dir = getTableDir(root, name);
  await ensureDir(dir);
  const tablePath = getTablePath(root, name);
  let state = await readJsonFile(tablePath, null);
  if (!state) {
    state = defaultTableState(name);
    if (options.embeddingModel) {
      state.embeddingModel = options.embeddingModel;
    }
    if (Number.isFinite(Number(options.dimensions))) {
      state.dimensions = Number(options.dimensions);
    }
    await writeTableState({ tableName: name, tablePath }, state);
  }
  return {
    projectRoot: root,
    tableName: name,
    tableDir: dir,
    tablePath,
  };
}

export async function upsertChunks(table, chunks) {
  const state = await readTableState(table);
  const nextRows = new Map(state.rows.map((row) => [row.id, row]));
  const updatedAt = nowIso();
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    if (!chunk || !chunk.id) {
      continue;
    }
    const row = {
      id: String(chunk.id),
      source: chunk.source || 'memory',
      filePath: String(chunk.filePath || ''),
      chunkIndex: Number(chunk.chunkIndex) || 0,
      content: String(chunk.content || ''),
      vector: normalizeVector(chunk.vector),
      metadata: typeof chunk.metadata === 'string' ? chunk.metadata : JSON.stringify(chunk.metadata || {}),
      updatedAt: chunk.updatedAt || updatedAt,
      sourceMtimeMs: Number.isFinite(Number(chunk.sourceMtimeMs)) ? Number(chunk.sourceMtimeMs) : null,
    };
    nextRows.set(row.id, row);
  }
  const next = {
    ...state,
    rows: [...nextRows.values()],
    updatedAt,
  };
  if (Array.isArray(chunks) && chunks.length) {
    const first = chunks[0];
    if (first?.embeddingModel) {
      next.embeddingModel = first.embeddingModel;
    }
    if (Number.isFinite(Number(first?.dimensions))) {
      next.dimensions = Number(first.dimensions);
    }
  }
  await writeTableState(table, next);
}

export async function deleteByPath(table, filePath) {
  const state = await readTableState(table);
  const normalizedPath = String(filePath || '');
  const nextRows = state.rows.filter((row) => row.filePath !== normalizedPath);
  if (nextRows.length === state.rows.length) {
    return;
  }
  await writeTableState(table, {
    ...state,
    rows: nextRows,
  });
}

function cosineSimilarity(a, b) {
  const left = normalizeVector(a);
  const right = normalizeVector(b);
  if (!left.length || !right.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = Number(left[index]) || 0;
    const y = Number(right[index]) || 0;
    dot += x * y;
    leftNorm += x * x;
    rightNorm += y * y;
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function matchesFilter(row, filter) {
  if (!filter) {
    return true;
  }
  if (typeof filter === 'function') {
    return Boolean(filter(row));
  }
  if (typeof filter !== 'object') {
    return true;
  }
  const metadata = parseMetadata(row.metadata);
  for (const [key, expected] of Object.entries(filter)) {
    if (key === 'metadata' && expected && typeof expected === 'object') {
      for (const [metaKey, metaValue] of Object.entries(expected)) {
        if (metadata?.[metaKey] !== metaValue) {
          return false;
        }
      }
      continue;
    }
    if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

export async function search(table, queryVector, opts = {}) {
  const state = await readTableState(table);
  const vector = normalizeVector(queryVector);
  if (state.dimensions && vector.length && state.dimensions !== vector.length) {
    throw createProviderError(
      'vector_dimensions_mismatch',
      `Размерность индекса ${state.dimensions} не совпадает с embedding vector ${vector.length}. Требуется rebuild.`,
    );
  }
  const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : 10;
  const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.6;
  const source = opts.source || null;
  const filter = opts.filter || null;

  const rows = state.rows
    .filter((row) => {
      if (source && row.source !== source) {
        return false;
      }
      return matchesFilter(row, filter);
    })
    .map((row) => {
      const score = cosineSimilarity(vector, row.vector);
      return {
        id: row.id,
        filePath: row.filePath,
        chunkIndex: row.chunkIndex,
        content: row.content,
        score,
        metadata: parseMetadata(row.metadata),
        source: row.source,
      };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.chunkIndex - b.chunkIndex);

  return rows.slice(0, limit);
}

export async function tableInfo(table) {
  const state = await readTableState(table);
  return {
    tableName: table.tableName,
    path: table.tablePath,
    embeddingModel: state.embeddingModel || null,
    dimensions: Number.isFinite(Number(state.dimensions)) ? Number(state.dimensions) : null,
    totalChunks: Array.isArray(state.rows) ? state.rows.length : 0,
    updatedAt: state.updatedAt || null,
  };
}

export async function clearTable(table) {
  await writeTableState(table, {
    ...defaultTableState(table.tableName),
    embeddingModel: null,
    dimensions: null,
    rows: [],
    updatedAt: nowIso(),
  });
}

export async function dropTable(projectRoot, tableName) {
  const tablePath = getTablePath(projectRoot, tableName);
  const tableDir = getTableDir(projectRoot, tableName);
  if (await fileExists(tablePath)) {
    await fs.rm(tableDir, { recursive: true, force: true });
  }
}

export function createChunkId(filePath, chunkIndex) {
  return stableHash(`${filePath}:${chunkIndex}`);
}

export function getVectorIndexRootPath(projectRoot) {
  return getVectorIndexRoot(projectRoot);
}
