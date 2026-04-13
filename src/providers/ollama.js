import { createProviderError, normalizeMessages, withTimeout } from './shared.js';

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 5000;

function getBaseUrl(config = {}) {
  return process.env.OLLAMA_HOST || config.baseUrl || DEFAULT_OLLAMA_HOST;
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw createProviderError('request_failed', `Запрос к Ollama не удался (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

async function fetchJsonWithTimeout(fetchImpl, url, init) {
  return withTimeout(fetchJson(fetchImpl, url, init), REQUEST_TIMEOUT_MS, 'Превышено время ожидания ответа Ollama.');
}

function parseStreamLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function chunkFromOllamaEvent(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  if (typeof event.response === 'string') {
    return event.response;
  }
  if (typeof event.message?.content === 'string') {
    return event.message.content;
  }
  if (Array.isArray(event.message?.content)) {
    return event.message.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

export function createProvider(config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = getBaseUrl(config);
  const defaultModel = config.defaultModel || 'qwen2.5-coder:14b';
  const providerName = 'ollama';

  async function listModels() {
    const data = await fetchJsonWithTimeout(fetchImpl, `${baseUrl}/api/tags`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .map((model) => model?.name)
      .filter((name) => typeof name === 'string' && name.length > 0);
  }

  async function healthCheck() {
    try {
      await listModels();
      return { ok: true, message: 'ok', code: 'ok' };
    } catch (error) {
      if (error?.code === 'timeout') {
        return { ok: false, message: error.message, code: 'timeout' };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error), code: error?.code || 'request_failed' };
    }
  }

  async function* chat(messages, options = {}) {
    const model = options.model || defaultModel;
    const normalizedMessages = normalizeMessages(messages);
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        stream: true,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw createProviderError('request_failed', `Запрос к Ollama не удался (${response.status}): ${body || response.statusText}`);
    }

    if (!response.body) {
      const data = await response.json();
      const content = chunkFromOllamaEvent(data);
      if (content) {
        yield content;
      }
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const event = parseStreamLine(trimmed);
        const content = chunkFromOllamaEvent(event);
        if (content) {
          yield content;
        }
      }
    }

    const tail = decoder.decode();
    const remaining = `${buffer}${tail}`;
    for (const line of remaining.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const event = parseStreamLine(line);
      const content = chunkFromOllamaEvent(event);
      if (content) {
        yield content;
      }
    }
  }

  return {
    name: providerName,
    defaultModel,
    enabled: config.enabled !== false,
    baseUrl,
    async *chat(messages, options) {
      yield* chat(messages, options);
    },
    listModels,
    healthCheck,
  };
}
