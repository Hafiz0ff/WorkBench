import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from '../security.js';
import { readProjectState, updateProjectState } from '../memory.js';
import { createProviderError } from './shared.js';

const PROVIDERS_FILE_NAME = 'providers.json';
const DEFAULT_PROVIDER_NAME = 'ollama';
const DEFAULT_PROVIDER_CONFIG = {
  default: DEFAULT_PROVIDER_NAME,
  contextWindow: {
    historyMessages: 20,
    summarizeAfter: 50,
  },
  providers: {
    ollama: {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      defaultModel: 'qwen2.5-coder:14b',
    },
    openai: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
    },
    anthropic: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-3-5-sonnet-20241022',
    },
    gemini: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-2.0-flash',
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

export async function listConfiguredProviderNames(projectRoot) {
  const config = await readProvidersConfig(projectRoot);
  return Object.keys(config.providers);
}

export async function getProvider(projectRoot, requestedName = null) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root),
  ]);
  const providerName = requestedName || state?.selectedProvider || config.default || DEFAULT_PROVIDER_NAME;
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
  return module.createProvider(providerConfig, { projectRoot: root });
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
    let health = { ok: false, message: 'disabled', code: 'disabled' };
    if (provider.enabled) {
      health = await provider.healthCheck();
    }
    summaries.push({
      name,
      enabled: provider.enabled,
      defaultModel: provider.defaultModel,
      selected: state?.selectedProvider === name,
      baseUrl: provider.baseUrl || providerConfig.baseUrl || null,
      health,
      apiKeySet: Boolean(providerConfig.apiKey),
    });
  }
  return {
    defaultProvider: config.default || DEFAULT_PROVIDER_NAME,
    providers: summaries,
  };
}

export async function useProvider(projectRoot, providerName) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
  const providerConfig = getProviderConfig(config, providerName);
  if (!providerConfig) {
    const available = Object.keys(config.providers).join(', ');
    throw createProviderError('provider_not_found', `Провайдер "${providerName}" не найден. Доступны: ${available}`);
  }
  const provider = await getProvider(root, providerName);
  await updateProjectState(root, {
    selectedProvider: provider.name,
    selectedModel: provider.defaultModel,
  });
  return provider;
}

export async function setProviderApiKey(projectRoot, providerName, apiKey) {
  const root = normalizeRoot(projectRoot);
  const config = await readProvidersConfig(root);
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
        apiKey,
        enabled: true,
      },
    },
  };
  await writeProvidersConfig(root, next);
  return next.providers[providerName];
}

export async function getActiveProviderSelection(projectRoot) {
  const root = normalizeRoot(projectRoot);
  const [config, state] = await Promise.all([
    readProvidersConfig(root),
    readProjectState(root),
  ]);
  const providerName = state?.selectedProvider || config.default || DEFAULT_PROVIDER_NAME;
  const provider = await getProvider(root, providerName);
  return {
    providerName: provider.name,
    model: state?.selectedModel || provider.defaultModel,
  };
}

export async function getContextWindowConfig(projectRoot) {
  const config = await readProvidersConfig(projectRoot);
  return {
    historyMessages: Number(config.contextWindow?.historyMessages) || DEFAULT_PROVIDER_CONFIG.contextWindow.historyMessages,
    summarizeAfter: Number(config.contextWindow?.summarizeAfter) || DEFAULT_PROVIDER_CONFIG.contextWindow.summarizeAfter,
  };
}

export { DEFAULT_PROVIDER_CONFIG, DEFAULT_PROVIDER_NAME };
