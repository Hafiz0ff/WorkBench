import { GoogleGenAI } from '@google/genai';
import { createProviderError, normalizeMessages, withTimeout } from './shared.js';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const REQUEST_TIMEOUT_MS = 5000;

function getApiKey(config = {}) {
  return config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
}

function getBaseUrl(config = {}) {
  return config.baseUrl || DEFAULT_GEMINI_BASE_URL;
}

function getClient(config = {}, deps = {}) {
  if (deps.client) {
    return deps.client;
  }
  const apiKey = getApiKey(config);
  if (!apiKey) {
    throw createProviderError('missing_api_key', 'API-ключ Gemini не настроен.');
  }
  return new GoogleGenAI({
    apiKey,
  });
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw createProviderError('request_failed', `Gemini request failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

async function fetchJsonWithTimeout(url, init) {
  return withTimeout(fetchJson(url, init), REQUEST_TIMEOUT_MS, 'Gemini request timed out.');
}

function buildGeminiPrompt(messages) {
  const normalized = normalizeMessages(messages);
  const system = normalized
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim();
  const dialogue = normalized
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n')
    .trim();
  return [system, dialogue].filter(Boolean).join('\n\n');
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'gemini';
  const defaultModel = config.defaultModel || 'gemini-2.0-flash';

  async function* chat(messages, options = {}) {
    const client = getClient(config, deps);
    const stream = await client.models.generateContentStream({
      model: options.model || defaultModel,
      contents: buildGeminiPrompt(messages),
    });
    for await (const chunk of stream) {
      if (typeof chunk?.text === 'string' && chunk.text.length > 0) {
        yield chunk.text;
      }
    }
  }

  async function listModels() {
    const apiKey = getApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Gemini не настроен.');
    }
    const data = await fetchJsonWithTimeout(`${getBaseUrl(config)}/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .map((model) => model?.name || model?.displayName)
      .filter((name) => typeof name === 'string' && name.length > 0);
  }

  async function healthCheck() {
    try {
      await listModels();
      return { ok: true, message: 'ok', code: 'ok' };
    } catch (error) {
      if (error?.code === 'missing_api_key') {
        return { ok: false, message: error.message, code: 'missing_api_key' };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error), code: error?.code || 'request_failed' };
    }
  }

  return {
    name: providerName,
    defaultModel,
    enabled: config.enabled !== false,
    baseUrl: getBaseUrl(config),
    async *chat(messages, options) {
      yield* chat(messages, options);
    },
    listModels,
    healthCheck,
  };
}
