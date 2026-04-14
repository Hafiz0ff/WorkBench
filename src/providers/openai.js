import { createProviderError, normalizeMessages } from './shared.js';
import { requestJson, requestRaw } from './http.js';
import { resolveSecretValue } from '../secrets.js';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'o4-mini',
];

async function resolveApiKey(config = {}) {
  const raw = config.apiKey || process.env.OPENAI_API_KEY || '';
  const resolved = await resolveSecretValue(raw);
  return String(resolved || '').trim();
}

function getBaseUrl(config = {}) {
  return String(config.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, '');
}

function normalizeModelInfo(model) {
  const id = String(model?.id || model?.name || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    name: model?.name || id,
    contextWindow: Number.isFinite(Number(model?.context_window)) ? Number(model.context_window) : Number.isFinite(Number(model?.contextWindow)) ? Number(model.contextWindow) : null,
    supportsStreaming: true,
  };
}

function extractTextFromCompletion(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message?.content;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((part) => part?.text || '').join('');
  }
  return choice?.text || '';
}

function extractUsage(data) {
  const usage = data?.usage || null;
  if (!usage) {
    return null;
  }
  return {
    promptTokens: Number(usage.prompt_tokens) || 0,
    completionTokens: Number(usage.completion_tokens) || 0,
    totalTokens: Number(usage.total_tokens) || ((Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0)),
  };
}

function buildHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

function parseStreamEvent(event) {
  if (!event?.data || event.data === '[DONE]') {
    return '';
  }
  try {
    const payload = JSON.parse(event.data);
    return payload?.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'openai';
  const defaultModel = config.model || config.defaultModel || 'gpt-4o';
  const baseUrl = getBaseUrl(config);

  async function complete(messages, options = {}) {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ OpenAI не настроен.');
    }
    const response = await requestJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: options.model || defaultModel,
        messages: normalizeMessages(messages),
        stream: false,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const data = response.json || {};
    return {
      content: extractTextFromCompletion(data),
      model: options.model || defaultModel,
      provider: providerName,
      usage: extractUsage(data),
      durationMs: 0,
      raw: data,
    };
  }

  async function* stream(messages, options = {}) {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ OpenAI не настроен.');
    }
    const response = await requestRaw(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: options.model || defaultModel,
        messages: normalizeMessages(messages),
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    for (const line of String(response.bodyText || '').replaceAll('\r\n', '\n').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const chunk = parseStreamEvent({ data: trimmed.slice(5).trimStart() });
      if (chunk) {
        yield chunk;
      }
    }
  }

  async function listModels() {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ OpenAI не настроен.');
    }
    const response = await requestJson(`${baseUrl}/models`, {
      method: 'GET',
      headers: buildHeaders(apiKey),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const models = Array.isArray(response.json?.data) ? response.json.data : [];
    const normalized = models.map(normalizeModelInfo).filter(Boolean);
    return normalized.length ? normalized : DEFAULT_MODELS.map((id) => ({
      id,
      name: id,
      contextWindow: null,
      supportsStreaming: true,
    }));
  }

  async function health() {
    const started = Date.now();
    try {
      await listModels();
      return { ok: true, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error?.message || String(error),
      };
    }
  }

  return {
    name: providerName,
    defaultModel,
    enabled: config.enabled !== false,
    baseUrl,
    async complete(messages, options) {
      return complete(messages, options);
    },
    async *stream(messages, options) {
      yield* stream(messages, options);
    },
    async *chat(messages, options) {
      yield* stream(messages, options);
    },
    health,
    healthCheck: health,
    listModels,
  };
}
