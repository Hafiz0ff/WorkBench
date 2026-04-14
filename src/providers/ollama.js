import { createProviderError, normalizeMessages } from './shared.js';
import { requestJson, requestRaw } from './http.js';

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const DEFAULT_MODELS = ['qwen2.5-coder:14b', 'llama3.1', 'mistral', 'phi3'];

function getBaseUrl(config = {}) {
  return String(process.env.OLLAMA_HOST || config.baseUrl || DEFAULT_OLLAMA_HOST).replace(/\/$/, '');
}

function extractText(data) {
  const message = data?.message?.content;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((part) => part?.text || '').filter(Boolean).join('');
  }
  if (typeof data?.response === 'string') {
    return data.response;
  }
  return '';
}

function parseNdjson(bodyText) {
  return String(bodyText || '')
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map(extractText)
    .filter(Boolean);
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'ollama';
  const defaultModel = config.model || config.defaultModel || 'qwen2.5-coder:14b';
  const baseUrl = getBaseUrl(config);

  async function complete(messages, options = {}) {
    const response = await requestJson(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: options.model || defaultModel,
        messages: normalizeMessages(messages),
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const data = response.json || {};
    return {
      content: extractText(data),
      model: options.model || defaultModel,
      provider: providerName,
      usage: null,
      durationMs: 0,
      raw: data,
    };
  }

  async function* stream(messages, options = {}) {
    const response = await requestRaw(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: options.model || defaultModel,
        messages: normalizeMessages(messages),
        stream: true,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    for (const chunk of parseNdjson(response.bodyText)) {
      yield chunk;
    }
  }

  async function listModels() {
    const response = await requestJson(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const models = Array.isArray(response.json?.models) ? response.json.models : [];
    const normalized = models.map((model) => {
      const id = String(model?.name || '').trim();
      if (!id) {
        return null;
      }
      return {
        id,
        name: model?.display_name || id,
        contextWindow: null,
        supportsStreaming: true,
      };
    }).filter(Boolean);
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
