import { readProjectPolicy } from './policy.js';
import { readSecrets } from './secrets.js';
import { embed as embedTexts, getEmbeddingProvider } from './embeddings.js';
import { ensureIndexExists } from './indexer.js';
import { openTable, search as searchTable, tableInfo } from './vectordb.js';
import { normalizeRoot } from './security.js';

function nowMs() {
  return Date.now();
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function parseMetadata(metadata) {
  if (!metadata) {
    return {};
  }
  if (typeof metadata === 'object') {
    return metadata;
  }
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function formatScore(score) {
  if (!Number.isFinite(score)) {
    return '0%';
  }
  return `${Math.round(score * 100)}%`;
}

function clipContent(text, maxLength) {
  const content = String(text || '');
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return content;
  }
  const limit = Math.floor(Number(maxLength));
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function renderEntry(entry, opts = {}) {
  const metadata = parseMetadata(entry.metadata);
  const content = opts.showContent === false
    ? ''
    : clipContent(entry.content, opts.maxContentLength || 240);
  const label = entry.source === 'code' ? 'code' : 'memory';
  const head = `- [${label}] ${entry.filePath}  score: ${formatScore(entry.score)}`;
  const metaLine = metadata && Object.keys(metadata).length ? `  ${JSON.stringify(metadata)}` : '';
  return [head, content ? `  ${content}` : '', opts.verbose && metaLine ? metaLine : ''].filter(Boolean).join('\n');
}

export async function semanticSearch(projectRoot, query, opts = {}) {
  const root = normalizeRoot(projectRoot);
  const searchQuery = String(query || '').trim();
  const startedAt = nowMs();
  if (!searchQuery) {
    return {
      query: searchQuery,
      results: [],
      durationMs: 0,
      embeddingModel: null,
    };
  }

  const policy = opts.policy || await readProjectPolicy(root).catch(() => ({}));
  const hasIndex = await ensureIndexExists(root, opts.target || 'all');
  if (!hasIndex) {
    return {
      query: searchQuery,
      results: [],
      durationMs: nowMs() - startedAt,
      embeddingModel: null,
    };
  }

  const embeddingProvider = opts.embeddingProvider || await getEmbeddingProvider({
    ...policy,
    projectRoot: root,
  }, await readSecrets().catch(() => ({})));
  const queryVector = (await embedTexts([searchQuery], embeddingProvider, { projectRoot: root }))[0];
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources : ['memory', 'code'];
  const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : 10;
  const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.6;
  const results = [];

  for (const source of sources) {
    const tableName = source === 'code' ? 'code' : 'memory';
    const table = await openTable(root, tableName, {
      embeddingModel: embeddingProvider.model,
      dimensions: embeddingProvider.dimensions,
    });
    const info = await tableInfo(table);
    if (info.totalChunks <= 0) {
      continue;
    }
    const rows = await searchTable(table, queryVector, {
      limit,
      minScore,
      source: source === 'code' ? 'code' : 'memory',
    });
    results.push(...rows);
  }

  results.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.chunkIndex - b.chunkIndex);
  return {
    query: searchQuery,
    results: results.slice(0, limit),
    durationMs: nowMs() - startedAt,
    embeddingModel: embeddingProvider.model,
  };
}

export function formatResults(results, opts = {}) {
  const entries = Array.isArray(results?.results) ? results.results : Array.isArray(results) ? results : [];
  if (!entries.length) {
    return 'Совпадений не найдено.';
  }
  const lines = [];
  if (results?.query) {
    lines.push(`Поиск: "${results.query}"`);
  }
  if (results?.embeddingModel) {
    lines.push(`Embedding: ${results.embeddingModel}`);
  }
  for (let index = 0; index < entries.length; index += 1) {
    lines.push(`${index + 1}. ${renderEntry(entries[index], opts)}`);
  }
  return lines.join('\n');
}

export function formatForContext(results, maxTokens = 2000) {
  const entries = Array.isArray(results?.results) ? results.results : Array.isArray(results) ? results : [];
  if (!entries.length) {
    return '';
  }
  const tokenLimit = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Math.floor(Number(maxTokens)) : 2000;
  const charLimit = tokenLimit * 4;
  const lines = ['## Relevant context', ''];
  let used = estimateTokens(lines.join('\n'));

  for (const entry of entries) {
    const metadata = parseMetadata(entry.metadata);
    const heading = `### [${entry.source}] ${entry.filePath} (${formatScore(entry.score)})`;
    const body = clipContent(entry.content, 700);
    const metaText = metadata && Object.keys(metadata).length ? `\n${JSON.stringify(metadata)}` : '';
    const block = `${heading}\n${body}${metaText}`.trim();
    const blockTokens = estimateTokens(block);
    if (used + blockTokens > tokenLimit || lines.join('\n').length + block.length > charLimit) {
      break;
    }
    lines.push(block);
    lines.push('');
    used += blockTokens;
  }

  return lines.join('\n').trim();
}
