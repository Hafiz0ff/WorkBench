import Anthropic from '@anthropic-ai/sdk';
import { createProviderError, normalizeMessages, withTimeout } from './shared.js';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 5000;

function getApiKey(config = {}) {
  return config.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

function getBaseUrl(config = {}) {
  return config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL;
}

function getClient(config = {}, deps = {}) {
  if (deps.client) {
    return deps.client;
  }
  const apiKey = getApiKey(config);
  if (!apiKey) {
    throw createProviderError('missing_api_key', 'API-ключ Anthropic не настроен.');
  }
  return new Anthropic({
    apiKey,
    baseURL: getBaseUrl(config),
  });
}

function createAsyncQueue() {
  const queue = [];
  let done = false;
  let error = null;
  let resolver = null;
  let rejecter = null;

  const wake = () => {
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      rejecter = null;
      resolve();
    }
  };

  return {
    push(value) {
      if (done || error || value === '') {
        return;
      }
      queue.push(value);
      wake();
    },
    close() {
      done = true;
      wake();
    },
    fail(err) {
      error = err;
      if (rejecter) {
        const reject = rejecter;
        resolver = null;
        rejecter = null;
        reject(err);
      }
    },
    async *iterator() {
      while (true) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        if (error) {
          throw error;
        }
        if (done) {
          return;
        }
        await new Promise((resolve, reject) => {
          resolver = resolve;
          rejecter = reject;
        });
      }
    },
  };
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw createProviderError('request_failed', `Anthropic request failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

async function fetchJsonWithTimeout(url, init) {
  return withTimeout(fetchJson(url, init), REQUEST_TIMEOUT_MS, 'Anthropic request timed out.');
}

function normalizeAnthropicMessages(messages) {
  const normalized = normalizeMessages(messages);
  const system = normalized
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim();
  const dialogue = normalized
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));
  return { system: system || undefined, dialogue };
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'anthropic';
  const defaultModel = config.defaultModel || 'claude-3-5-sonnet-20241022';

  async function* chat(messages, options = {}) {
    const client = getClient(config, deps);
    const { system, dialogue } = normalizeAnthropicMessages(messages);
    const stream = client.messages.stream({
      model: options.model || defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      system,
      messages: dialogue,
    });

    const queue = createAsyncQueue();
    stream.on('text', (text) => queue.push(text));
    const finalMessagePromise = stream.finalMessage().then(
      () => queue.close(),
      (error) => queue.fail(error),
    );

    try {
      for await (const chunk of queue.iterator()) {
        yield chunk;
      }
    } finally {
      await finalMessagePromise.catch(() => {});
    }
  }

  async function listModels() {
    const apiKey = getApiKey(config);
    if (!apiKey) {
      throw createProviderError('missing_api_key', 'API-ключ Anthropic не настроен.');
    }
    const data = await fetchJsonWithTimeout(`${getBaseUrl(config)}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': config.apiVersion || DEFAULT_ANTHROPIC_VERSION,
        accept: 'application/json',
      },
    });
    const models = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return models
      .map((model) => model?.id || model?.name)
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
