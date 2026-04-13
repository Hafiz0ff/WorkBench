import fs from 'node:fs/promises';

const DEFAULT_LOCALE = 'ru';
const cache = new Map();

function normalizeLocale(locale) {
  if (typeof locale !== 'string' || !locale.trim()) {
    return DEFAULT_LOCALE;
  }
  return locale.trim().toLowerCase().replace('_', '-').split('-')[0];
}

function deepGet(object, key) {
  return key.split('.').reduce((value, segment) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, segment)) {
      return value[segment];
    }
    return undefined;
  }, object);
}

function interpolate(template, values) {
  if (typeof template !== 'string') {
    return String(template);
  }
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return `{${key}}`;
    }
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

async function loadLocaleFile(locale) {
  const normalized = normalizeLocale(locale);
  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const fileUrl = new URL(`./i18n/${normalized}.json`, import.meta.url);
  const content = await fs.readFile(fileUrl, 'utf8').catch(async () => {
    if (normalized === DEFAULT_LOCALE) {
      return '{}';
    }
    const fallbackUrl = new URL(`./i18n/${DEFAULT_LOCALE}.json`, import.meta.url);
    return fs.readFile(fallbackUrl, 'utf8');
  });

  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  cache.set(normalized, parsed);
  return parsed;
}

export function getDefaultLocale() {
  return DEFAULT_LOCALE;
}

export async function createTranslator(locale = DEFAULT_LOCALE) {
  const normalized = normalizeLocale(locale);
  const [primary, fallback] = await Promise.all([
    loadLocaleFile(normalized),
    loadLocaleFile(DEFAULT_LOCALE),
  ]);

  return (key, values = {}) => {
    const raw = deepGet(primary, key) ?? deepGet(fallback, key) ?? key;
    return interpolate(raw, values);
  };
}

export function normalizeLocaleCode(locale) {
  return normalizeLocale(locale);
}
