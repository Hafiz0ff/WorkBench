import { requestJson, requestRaw } from './providers/http.js';
import { createProviderError } from './providers/shared.js';
import { readSecrets, resolveSecretValue } from './secrets.js';
import { trackUsage } from './budget.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_OLLAMA_DIMENSIONS = 768;
const DEFAULT_OPENAI_DIMENSIONS = 1536;
const DEFAULT_OLLAMA_BATCH_SIZE = 32;
const DEFAULT_OPENAI_BATCH_SIZE = 100;

function nowIso() {
  return new Date().toISOString();
}

function normalizeRoot(projectRoot) {
  return projectRoot ? String(projectRoot) : null;
}

function normalizeName(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return text || fallback;
}

function chunkArray(values, size) {
  const chunkSize = Number.isFinite(Number(size)) && Number(size) > 0 ? Math.floor(Number(size)) : 32;
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

async function resolveApiKey(ref, secrets = null) {
  if (typeof ref !== 'string' || !ref.trim()) {
    return '';
  }
  if (!ref.startsWith('@secret:')) {
    return ref.trim();
  }
  const key = ref.slice('@secret:'.length).trim();
  if (!key) {
    return '';
  }
  if (secrets && typeof secrets === 'object' && typeof secrets[key] === 'string') {
    return secrets[key].trim();
  }
  const resolved = await resolveSecretValue(ref);
  return String(resolved || '').trim();
}

function createEmbeddingTracker(provider, texts, embeddingCount, projectRoot) {
  const promptTokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
  const totalTokens = promptTokens;
  if (!projectRoot) {
    return null;
  }
  return trackUsage(projectRoot, {
    provider: provider.name,
    model: provider.model,
    promptTokens,
    completionTokens: 0,
    totalTokens,
    source: 'embedding',
    estimated: true,
  }).catch(() => null);
}

async function embedBatch(provider, texts, options = {}) {
  const projectRoot = normalizeRoot(options.projectRoot || provider.projectRoot || null);
  const startedAt = Date.now();
  const vectors = await provider.embed(texts, options);
  if (!Array.isArray(vectors)) {
    throw createProviderError('invalid_embedding_response', 'Embedding provider returned an invalid payload.');
  }
  if (projectRoot) {
    await createEmbeddingTracker(provider, texts, vectors.length, projectRoot);
  }
  return vectors.map((vector) => (vector instanceof Float32Array ? vector : new Float32Array(vector)));
}

export async function embed(texts, provider, options = {}) {
  const items = Array.isArray(texts) ? texts.map((value) => String(value ?? '')) : [];
  if (!provider || typeof provider.embed !== 'function') {
    throw createProviderError('embedding_provider_missing', 'Embedding provider is not available.');
  }
  if (!items.length) {
    return [];
  }
  const batchSize = Number.isFinite(Number(provider.batchSize)) && Number(provider.batchSize) > 0
    ? Math.floor(Number(provider.batchSize))
    : DEFAULT_OLLAMA_BATCH_SIZE;
  const result = [];
  for (const batch of chunkArray(items, batchSize)) {
    const vectors = await embedBatch(provider, batch, options);
    result.push(...vectors);
  }
  return result;
}

function normalizeOllamaUrl(value) {
  return String(value || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
}

function normalizeOpenAIUrl(value) {
  return String(value || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, '');
}

function extractOllamaEmbeddings(response) {
  const embeddings = Array.isArray(response?.embeddings)
    ? response.embeddings
    : Array.isArray(response?.data)
      ? response.data.map((item) => item?.embedding || [])
      : [];
  return embeddings.map((vector) => new Float32Array(Array.isArray(vector) ? vector : []));
}

function extractOpenAIEmbeddings(response) {
  const embeddings = Array.isArray(response?.data)
    ? response.data.map((item) => item?.embedding || [])
    : [];
  return embeddings.map((vector) => new Float32Array(Array.isArray(vector) ? vector : []));
}

export function createOllamaEmbeddings(config = {}, deps = {}) {
  const projectRoot = normalizeRoot(config.projectRoot || deps.projectRoot || null);
  const model = config.model || DEFAULT_OLLAMA_MODEL;
  const dimensions = Number(config.dimensions) || DEFAULT_OLLAMA_DIMENSIONS;
  const baseUrl = normalizeOllamaUrl(config.baseUrl || DEFAULT_OLLAMA_BASE_URL);

  return {
    name: 'ollama',
    model,
    dimensions,
    batchSize: Number(config.batchSize) || DEFAULT_OLLAMA_BATCH_SIZE,
    projectRoot,
    baseUrl,
    async embed(texts) {
      const input = Array.isArray(texts) ? texts.map((value) => String(value ?? '')) : [];
      const response = await requestJson(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model, input }),
        maxRetries: Number(config.maxRetries) || 0,
        timeoutMs: Number(config.timeout) || 60000,
      }, deps);
      return extractOllamaEmbeddings(response.json);
    },
    async health() {
      const started = Date.now();
      try {
        await requestRaw(`${baseUrl}/api/version`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          maxRetries: 0,
          timeoutMs: Number(config.timeout) || 60000,
        }, deps);
        return { ok: true, latencyMs: Date.now() - started, error: null };
      } catch (error) {
        return { ok: false, latencyMs: Date.now() - started, error: error?.message || String(error) };
      }
    },
  };
}

export function createOpenAIEmbeddings(config = {}, deps = {}) {
  const projectRoot = normalizeRoot(config.projectRoot || deps.projectRoot || null);
  const model = config.model || DEFAULT_OPENAI_MODEL;
  const dimensions = Number(config.dimensions) || DEFAULT_OPENAI_DIMENSIONS;
  const baseUrl = normalizeOpenAIUrl(config.baseUrl || DEFAULT_OPENAI_BASE_URL);

  return {
    name: 'openai',
    model,
    dimensions,
    batchSize: Number(config.batchSize) || DEFAULT_OPENAI_BATCH_SIZE,
    projectRoot,
    baseUrl,
    async embed(texts) {
      const input = Array.isArray(texts) ? texts.map((value) => String(value ?? '')) : [];
      const apiKey = await resolveApiKey(config.apiKey || process.env.OPENAI_API_KEY || '', deps.secrets || null);
      if (!apiKey) {
        throw createProviderError('missing_api_key', 'API-ключ OpenAI embeddings не настроен.');
      }
      const response = await requestJson(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input }),
        maxRetries: Number(config.maxRetries) || 0,
        timeoutMs: Number(config.timeout) || 60000,
      }, deps);
      return extractOpenAIEmbeddings(response.json);
    },
    async health() {
      const started = Date.now();
      try {
        const apiKey = await resolveApiKey(config.apiKey || process.env.OPENAI_API_KEY || '', deps.secrets || null);
        if (!apiKey) {
          throw createProviderError('missing_api_key', 'API-ключ OpenAI embeddings не настроен.');
        }
        await requestRaw(`${baseUrl}/models`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          maxRetries: 0,
          timeoutMs: Number(config.timeout) || 60000,
        }, deps);
        return { ok: true, latencyMs: Date.now() - started, error: null };
      } catch (error) {
        return { ok: false, latencyMs: Date.now() - started, error: error?.message || String(error) };
      }
    },
  };
}

export async function getEmbeddingProvider(policy = {}, secrets = null) {
  const vectorIndex = policy?.vectorIndex || policy || {};
  const projectRoot = normalizeRoot(policy?.projectRoot || policy?.root || null);
  const providerName = normalizeName(vectorIndex.embeddingProvider || 'ollama', 'ollama');
  const config = {
    ollama: {
      model: vectorIndex.embeddingModel || DEFAULT_OLLAMA_MODEL,
      dimensions: Number(vectorIndex.dimensions) || DEFAULT_OLLAMA_DIMENSIONS,
      baseUrl: vectorIndex.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
      projectRoot,
      batchSize: DEFAULT_OLLAMA_BATCH_SIZE,
    },
    openai: {
      model: vectorIndex.openaiEmbeddingModel || vectorIndex.embeddingModel || DEFAULT_OPENAI_MODEL,
      dimensions: Number(vectorIndex.dimensions) || DEFAULT_OPENAI_DIMENSIONS,
      baseUrl: vectorIndex.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
      apiKey: vectorIndex.openaiApiKey || '@secret:openai_api_key',
      projectRoot,
      batchSize: DEFAULT_OPENAI_BATCH_SIZE,
    },
  };
  const candidates = providerName === 'openai'
    ? ['openai', 'ollama']
    : ['ollama', 'openai'];
  const resolvedSecrets = secrets || await readSecrets().catch(() => ({}));
  let lastError = null;

  for (const candidate of candidates) {
    const provider = candidate === 'openai'
      ? createOpenAIEmbeddings(config.openai, { secrets: resolvedSecrets })
      : createOllamaEmbeddings(config.ollama, {});
    const health = await provider.health().catch((error) => ({
      ok: false,
      latencyMs: 0,
      error: error?.message || String(error),
    }));
    if (health.ok) {
      return provider;
    }
    lastError = health.error || lastError;
  }

  throw createProviderError(
    'embedding_provider_unavailable',
    `${lastError || 'Embedding provider unavailable.'} Попробуйте выполнить \`ollama pull nomic-embed-text\` или настройте OpenAI embeddings.`,
  );
}
