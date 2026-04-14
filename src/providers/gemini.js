import { createProviderError, normalizeMessages } from './shared.js';
import { requestJson, requestRaw } from './http.js';
import { resolveSecretValue } from '../secrets.js';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

async function resolveApiKey(config = {}) {
  const raw = config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  const resolved = await resolveSecretValue(raw);
  return String(resolved || '').trim();
}

function getBaseUrl(config = {}) {
  return String(config.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, '');
}

function convertMessages(messages) {
  const normalized = normalizeMessages(messages);
  const contents = [];
  let systemInstruction = '';

  const pushContent = (role, text) => {
    const normalizedRole = role === 'assistant' ? 'model' : role;
    const last = contents[contents.length - 1];
    if (last && last.role === normalizedRole) {
      last.parts.push({ text });
      return;
    }
    contents.push({
      role: normalizedRole,
      parts: [{ text }],
    });
  };

  for (const message of normalized) {
    if (message.role === 'system') {
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${message.content}` : message.content;
      continue;
    }
    pushContent(message.role, message.content);
  }

  return {
    contents,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
  };
}

function extractText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const parts = candidates[0]?.content?.parts || [];
  return parts.map((part) => part?.text || '').filter(Boolean).join('');
}

function extractUsage(data) {
  const usage = data?.usageMetadata || null;
  if (!usage) {
    return null;
  }
  return {
    promptTokens: Number(usage.promptTokenCount) || 0,
    completionTokens: Number(usage.candidatesTokenCount) || 0,
    totalTokens: (Number(usage.promptTokenCount) || 0) + (Number(usage.candidatesTokenCount) || 0),
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
      const text = extractText(payload);
      if (text) {
        chunks.push(text);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return chunks;
}

function normalizeModelInfo(model) {
  const id = String(model?.name || model?.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    name: String(model?.displayName || model?.name || model?.id || id).trim(),
    contextWindow: Number.isFinite(Number(model?.inputTokenLimit)) ? Number(model.inputTokenLimit) : null,
    supportsStreaming: true,
  };
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'gemini';
  const defaultModel = config.model || config.defaultModel || 'gemini-2.0-flash';
  const baseUrl = getBaseUrl(config);

  async function complete(messages, options = {}) {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Gemini не настроен.');
    }
    const converted = convertMessages(messages);
    const response = await requestJson(
      `${baseUrl}/v1beta/models/${encodeURIComponent(options.model || defaultModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          contents: converted.contents,
          systemInstruction: converted.systemInstruction,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens || config.maxTokens || 8192,
          },
        }),
        maxRetries: Number(config.maxRetries) || 0,
        timeoutMs: Number(config.timeout) || 60000,
      },
      deps,
    );
    const data = response.json || {};
    return {
      content: extractText(data),
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
      throw createProviderError('missing_api_key', 'API-ключ Gemini не настроен.');
    }
    const converted = convertMessages(messages);
    const response = await requestRaw(
      `${baseUrl}/v1beta/models/${encodeURIComponent(options.model || defaultModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          contents: converted.contents,
          systemInstruction: converted.systemInstruction,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens || config.maxTokens || 8192,
          },
        }),
        maxRetries: Number(config.maxRetries) || 0,
        timeoutMs: Number(config.timeout) || 60000,
      },
      deps,
    );
    for (const chunk of parseStreamText(response.bodyText)) {
      yield chunk;
    }
  }

  async function listModels() {
    const apiKey = await resolveApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Gemini не настроен.');
    }
    const response = await requestJson(`${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      maxRetries: Number(config.maxRetries) || 0,
      timeoutMs: Number(config.timeout) || 60000,
    }, deps);
    const models = Array.isArray(response.json?.models) ? response.json.models : [];
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
