import { createProviderError, normalizeMessages } from './shared.js';
import { requestJson, requestRaw } from './http.js';
import { resolveSecretValue } from '../secrets.js';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-3-5',
];

async function resolveApiKey(config = {}) {
  const raw = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const resolved = await resolveSecretValue(raw);
  return String(resolved || '').trim();
}

function getBaseUrl(config = {}) {
  return String(config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, '');
}

function normalizeAnthropicMessages(messages) {
  const normalized = normalizeMessages(messages);
  let system = '';
  const dialogue = [];
  let firstSystemSeen = false;
  for (const message of normalized) {
    if (message.role === 'system' && !firstSystemSeen) {
      system = message.content;
      firstSystemSeen = true;
      continue;
    }
    dialogue.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  }
  return { system: system || undefined, dialogue };
}

function extractText(content = []) {
  return content
    .map((part) => part?.text || part?.content || '')
    .filter(Boolean)
    .join('');
}

function extractUsage(data) {
  const usage = data?.usage || null;
  if (!usage) {
    return null;
  }
  return {
    promptTokens: Number(usage.input_tokens) || 0,
    completionTokens: Number(usage.output_tokens) || 0,
    totalTokens: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0),
  };
}

function buildHeaders(apiKey, config = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': config.apiVersion || DEFAULT_ANTHROPIC_VERSION,
  };
}

function parseStreamText(bodyText) {
  const chunks = [];
  const lines = String(bodyText || '').replaceAll('\r\n', '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const data = trimmed.slice(5).trimStart();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const payload = JSON.parse(data);
      if (payload?.type === 'content_block_delta') {
        const chunk = payload.delta?.text || '';
        if (chunk) chunks.push(chunk);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return chunks;
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'anthropic';
  const defaultModel = config.model || config.defaultModel || 'claude-3-5-sonnet-20241022';
  const baseUrl = getBaseUrl(config);

  async function complete(messages, options = {}) {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Anthropic не настроен.');
    }
    const { system, dialogue } = normalizeAnthropicMessages(messages);
    const response = await requestJson(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: buildHeaders(apiKey, config),
      body: JSON.stringify({
        model: options.model || defaultModel,
        max_tokens: options.maxTokens || config.maxTokens || 4096,
        temperature: options.temperature,
        system,
        messages: dialogue,
        stream: false,
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const data = response.json || {};
    return {
      content: extractText(Array.isArray(data.content) ? data.content : []),
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
      throw createProviderError('missing_api_key', 'API-ключ Anthropic не настроен.');
    }
    const { system, dialogue } = normalizeAnthropicMessages(messages);
    const response = await requestRaw(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: buildHeaders(apiKey, config),
      body: JSON.stringify({
        model: options.model || defaultModel,
        max_tokens: options.maxTokens || config.maxTokens || 4096,
        temperature: options.temperature,
        system,
        messages: dialogue,
        stream: true,
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    for (const chunk of parseStreamText(response.bodyText)) {
      yield chunk;
    }
  }

  async function listModels() {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Anthropic не настроен.');
    }
    const response = await requestJson(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: buildHeaders(apiKey, config),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const models = Array.isArray(response.json?.data) ? response.json.data : [];
    const normalized = models.map((model) => ({
      id: String(model?.id || model?.name || '').trim(),
      name: String(model?.display_name || model?.name || model?.id || '').trim(),
      contextWindow: Number.isFinite(Number(model?.context_window)) ? Number(model.context_window) : null,
      supportsStreaming: true,
    })).filter((model) => model.id);
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
      return { ok: false, latencyMs: Date.now() - started, error: error?.message || String(error) };
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
