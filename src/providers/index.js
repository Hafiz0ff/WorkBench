import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from '../security.js';
import { readProjectState, updateProjectState } from '../memory.js';
import { createProviderError } from './shared.js';
import { resolveSecretValue, setSecretValue } from '../secrets.js';
import { emitter } from '../events.js';
import { trackEvent } from '../stats.js';
import { trackUsage } from '../budget.js';

const PROVIDERS_FILE_NAME = 'providers.json';
const DEFAULT_PROVIDER_NAME = 'ollama';
const DEFAULT_PROVIDER_CONFIG = {
  active: DEFAULT_PROVIDER_NAME,
  fallback: DEFAULT_PROVIDER_NAME,
  default: DEFAULT_PROVIDER_NAME,
  contextWindow: {
    historyMessages: 20,
    summarizeAfter: 50,
  },
  providers: {
    ollama: {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5-coder:14b',
      defaultModel: 'qwen2.5-coder:14b',
    },
    openai: {
      enabled: false,
      apiKey: '@secret:openai_api_key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      defaultModel: 'gpt-4o',
      timeout: 60000,
      maxRetries: 2,
      temperature: 0.2,
    },
    anthropic: {
      enabled: false,
      apiKey: '@secret:anthropic_api_key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4-5',
      defaultModel: 'claude-opus-4-5',
      timeout: 60000,
      maxRetries: 2,
      maxTokens: 16000,
    },
    gemini: {
      enabled: false,
      apiKey: '@secret:gemini_api_key',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-2.5-flash',
      defaultModel: 'gemini-2.5-flash',
      timeout: 60000,
      maxRetries: 2,
    },
  },
};

const PROVIDER_MODULE_LOADERS = {
  ollama: () => import('./ollama.js'),
  openai: () => import('./openai.js'),
  anthropic: () => import('./anthropic.js'),
  gemini: () => import('./gemini.js'),
};

function nowIso() {
  return new Date().toISOString();
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getProvidersRoot(projectRoot) {
  return path.join(normalizeRoot(projectRoot), '.local-codex');
}

export function getProvidersConfigPath(projectRoot) {
  return path.join(getProvidersRoot(projectRoot), PROVIDERS_FILE_NAME);
}

function mergeProviderConfig(defaultConfig, storedConfig = {}) {
  const providers = { ...defaultConfig.providers };
  for (const [name, providerConfig] of Object.entries(storedConfig.providers || {})) {
    providers[name] = {
      ...(providers[name] || {}),
      ...providerConfig,
    };
  }
  return {
    active: storedConfig.active || storedConfig.default || defaultConfig.active,
    fallback: storedConfig.fallback || defaultConfig.fallback,
    default: storedConfig.default || defaultConfig.default,
    contextWindow: {
      ...defaultConfig.contextWindow,
      ...(storedConfig.contextWindow || {}),
    },
    providers,
  };
}

export async function ensureProvidersWorkspace(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const providersRoot = getProvidersRoot(root);
  await fs.mkdir(providersRoot, { recursive: true });
  const configPath = getProvidersConfigPath(root);
  if (!(await fileExists(configPath))) {
    const timestamp = nowIso();
    const config = {
      ...DEFAULT_PROVIDER_CONFIG,
      contextWindow: { ...DEFAULT_PROVIDER_CONFIG.contextWindow },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
  return configPath;
}

export async function readProvidersConfig(projectRoot) {
  const root = normalizeRoot(projectRoot);
  await ensureProvidersWorkspace(root);
  const configPath = getProvidersConfigPath(root);
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  return mergeProviderConfig(DEFAULT_PROVIDER_CONFIG, parsed);
}

export async function writeProvidersConfig(projectRoot, config) {
  const root = normalizeRoot(projectRoot);
  await ensureProvidersWorkspace(root);
  const configPath = getProvidersConfigPath(root);
  const stored = {
    ...DEFAULT_PROVIDER_CONFIG,
    ...config,
    contextWindow: {
      ...DEFAULT_PROVIDER_CONFIG.contextWindow,
      ...(config.contextWindow || {}),
    },
    providers: config.providers || DEFAULT_PROVIDER_CONFIG.providers,
    updatedAt: nowIso(),
    createdAt: config.createdAt || nowIso(),
  };
  await fs.writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return stored;
}

function getProviderConfig(config, name) {
  return config.providers?.[name] || null;
}

async function resolveProviderApiKey(providerConfig = {}) {
  const apiKey = providerConfig.apiKey || '';
  return resolveSecretValue(apiKey);
}

function normalizeProviderInstance(provider) {
  if (!provider) {
    return null;
  }
  return {
    ...provider,
    complete: provider.complete || provider.chat || null,
    stream: provider.stream || provider.chat || null,
    health: provider.health || provider.healthCheck || null,
    healthCheck: provider.healthCheck || provider.health || null,
  };
}

function isFallbackable(error) {
  if (!error) return false;
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;
  if (error.status === 429 || error.status === 503) return true;
  return false;
}

export async function listProviders(projectRoot) {
  const config = await readProvidersConfig(projectRoot);
  return Object.keys(config.providers);
}

export async function getProvider(projectRoot, requestedName = null) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root),
  ]);
  const providerName = requestedName || state?.selectedProvider || config.active || config.default || DEFAULT_PROVIDER_NAME;
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const moduleLoader = PROVIDER_MODULE_LOADERS[providerName];
  if (!moduleLoader) {
    throw createProviderError('provider_not_supported', `Провайдер "${providerName}" не поддерживается.`);
  }

  const module = await moduleLoader();
  const resolvedConfig = {
    ...providerConfig,
    apiKey: await resolveProviderApiKey(providerConfig),
  };
  const provider = module.createProvider(resolvedConfig, {
    projectRoot: root,
    secretResolver: resolveSecretValue,
  });
  return normalizeProviderInstance(provider);
}

export async function completeWithFallback(projectRoot, messages, options = {}) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const state = await readProjectState(root).catch(() => null);
  const activeName = options.provider || state?.selectedProvider || config.active || config.default || DEFAULT_PROVIDER_NAME;
  const fallbackName = config.fallback || DEFAULT_PROVIDER_NAME;
  const provider = await getProvider(root, activeName);
  try {
    const result = await provider.complete(messages, options);
    void trackUsage(root, {
      provider: provider.name,
      model: result?.model || options.model || provider.defaultModel || null,
      promptTokens: result?.usage?.promptTokens ?? null,
      completionTokens: result?.usage?.completionTokens ?? null,
      totalTokens: result?.usage?.totalTokens ?? null,
      taskId: options.taskId || null,
      sessionId: options.sessionId || null,
    }).catch(() => {});
    void trackEvent(root, {
      type: 'provider.request',
      provider: provider.name,
      model: result?.model || options.model || provider.defaultModel || null,
      promptTokens: result?.usage?.promptTokens ?? null,
      completionTokens: result?.usage?.completionTokens ?? null,
      totalTokens: result?.usage?.totalTokens ?? null,
      taskId: options.taskId || null,
      sessionId: options.sessionId || null,
    }).catch(() => {});
    return result;
  } catch (error) {
    if (!fallbackName || fallbackName === activeName || !isFallbackable(error)) {
      throw error;
    }
    const fallbackProvider = await getProvider(root, fallbackName);
    emitter.emit('workbench:event', {
      type: 'provider.fallback',
      projectRoot: root,
      from: activeName,
      to: fallbackName,
      reason: error?.message || String(error),
    });
    const result = await fallbackProvider.complete(messages, options);
    void trackUsage(root, {
      provider: fallbackProvider.name,
      model: result?.model || options.model || fallbackProvider.defaultModel || null,
      promptTokens: result?.usage?.promptTokens ?? null,
      completionTokens: result?.usage?.completionTokens ?? null,
      totalTokens: result?.usage?.totalTokens ?? null,
      taskId: options.taskId || null,
      sessionId: options.sessionId || null,
    }).catch(() => {});
    void trackEvent(root, {
      type: 'provider.request',
      provider: fallbackProvider.name,
      model: result?.model || options.model || fallbackProvider.defaultModel || null,
      promptTokens: result?.usage?.promptTokens ?? null,
      completionTokens: result?.usage?.completionTokens ?? null,
      totalTokens: result?.usage?.totalTokens ?? null,
      taskId: options.taskId || null,
      sessionId: options.sessionId || null,
    }).catch(() => {});
    return result;
  }
}

export async function healthCheck(projectRoot, providerNames = null) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const names = Array.isArray(providerNames) && providerNames.length
    ? providerNames
    : Object.keys(config.providers);
  const results = [];
  for (const name of names) {
    const providerConfig = getProviderConfig(config, name);
    if (!providerConfig) {
      results.push({
        name,
        ok: false,
        latencyMs: 0,
        error: 'provider_not_found',
        enabled: false,
      });
      continue;
    }
    const provider = await getProvider(root, name);
    if (!provider.enabled) {
      results.push({
        name,
        ok: false,
        latencyMs: 0,
        error: 'disabled',
        enabled: false,
      });
      continue;
    }
    const result = await provider.health();
    results.push({
      name,
      ok: Boolean(result.ok),
      latencyMs: Number(result.latencyMs) || 0,
      error: result.error || null,
      enabled: true,
    });
  }
  return results;
}

export async function listProviderSummaries(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root),
  ]);
  const summaries = [];
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const provider = await getProvider(root, name);
    const health = provider.enabled ? await provider.health() : { ok: false, latencyMs: 0, error: 'disabled' };
    const models = provider.enabled ? await provider.listModels().catch(() => []) : [];
    const modelId = providerConfig.model || providerConfig.defaultModel || provider.defaultModel || null;
    summaries.push({
      name,
      enabled: provider.enabled,
      model: modelId,
      defaultModel: provider.defaultModel,
      selected: state?.selectedProvider === name || config.active === name,
      fallback: config.fallback === name,
      baseUrl: provider.baseUrl || providerConfig.baseUrl || null,
      health,
      apiKeySet: Boolean(providerConfig.apiKey),
      models,
    });
  }
  return {
    activeProvider: config.active || config.default || DEFAULT_PROVIDER_NAME,
    fallbackProvider: config.fallback || null,
    providers: summaries,
  };
}

export async function useProvider(projectRoot, providerName, { model = null } = {}) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const provider = await getProvider(root, providerName);
  const selectedModel = model || providerConfig.model || provider.defaultModel;
  const next = {
    ...config,
    active: provider.name,
    default: provider.name,
    providers: {
      ...config.providers,
      [providerName]: {
        ...providerConfig,
        model: selectedModel,
        defaultModel: selectedModel,
      },
    },
  };
  await writeProvidersConfig(root, next);
  await updateProjectState(root, {
    selectedProvider: provider.name,
    selectedModel,
  });
  return provider;
}

export async function setProviderModel(projectRoot, providerName, model) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root).catch(() => null),
  ]);
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const next = {
    ...config,
    providers: {
      ...config.providers,
      [providerName]: {
        ...providerConfig,
        model,
        defaultModel: model,
      },
    },
  };
  await writeProvidersConfig(root, next);
  if ((state?.selectedProvider || config.active || config.default) === providerName) {
    await updateProjectState(root, {
      selectedProvider: providerName,
      selectedModel: model,
    });
  }
  return next.providers[providerName];
}

export async function setProviderApiKey(projectRoot, providerName, apiKey) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const secretKey = `${providerName}_api_key`;
  await setSecretValue(secretKey, apiKey);
  const next = {
    ...config,
    providers: {
      ...config.providers,
      [providerName]: {
        ...providerConfig,
        apiKey: `@secret:${secretKey}`,
        enabled: true,
      },
    },
  };
  await writeProvidersConfig(root, next);
  return next.providers[providerName];
}

export async function setProviderFallback(projectRoot, providerName) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const next = {
    ...config,
    fallback: providerName,
  };
  await writeProvidersConfig(root, next);
  return providerName;
}

export async function getActiveProviderSelection(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root),
  ]);
  const providerName = state?.selectedProvider || config.active || config.default || DEFAULT_PROVIDER_NAME;
  const provider = await getProvider(root, providerName);
  return {
    providerName: provider.name,
    model: state?.selectedModel || config.providers?.[providerName]?.model || provider.defaultModel,
  };
}

export async function getContextWindowConfig(projectRoot) {
  const config = await readProvidersConfig(projectRoot);
  return {
    historyMessages: Number(config.contextWindow?.historyMessages) || DEFAULT_PROVIDER_CONFIG.contextWindow.historyMessages,
    summarizeAfter: Number(config.contextWindow?.summarizeAfter) || DEFAULT_PROVIDER_CONFIG.contextWindow.summarizeAfter,
  };
}

export async function listProviderModels(projectRoot, providerName) {
  const provider = await getProvider(projectRoot, providerName);
  return provider.listModels();
}

export { DEFAULT_PROVIDER_CONFIG, DEFAULT_PROVIDER_NAME };
