import OpenAI from 'openai';
import { createProviderError, normalizeMessages } from './shared.js';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function getApiKey(config = {}) {
  return config.apiKey || process.env.OPENAI_API_KEY || '';
}

function getClient(config = {}, deps = {}) {
  if (deps.client) {
    return deps.client;
  }
  const apiKey = getApiKey(config);
  if (!apiKey) {
    throw createProviderError('missing_api_key', 'API-ключ OpenAI не настроен.');
  }
  return new OpenAI({
    apiKey,
    baseURL: config.baseUrl || DEFAULT_OPENAI_BASE_URL,
  });
}

export function createProvider(config = {}, deps = {}) {
  const providerName = 'openai';
  const defaultModel = config.defaultModel || 'gpt-4o';

  async function* chat(messages, options = {}) {
    const client = getClient(config, deps);
    const stream = await client.chat.completions.create({
      model: options.model || defaultModel,
      messages: normalizeMessages(messages),
      stream: true,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    });

    for await (const event of stream) {
      const content = event?.choices?.[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async function listModels() {
    const client = getClient(config, deps);
    const response = await client.models.list();
    return (response?.data || [])
      .map((model) => model?.id)
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
    baseUrl: config.baseUrl || DEFAULT_OPENAI_BASE_URL,
    async *chat(messages, options) {
      yield* chat(messages, options);
    },
    listModels,
    healthCheck,
  };
}
