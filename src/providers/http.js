import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { createProviderError } from './shared.js';

const DEFAULT_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTransport(url) {
  return new URL(url).protocol === 'http:' ? http : https;
}

function createRequestOptions(url, init = {}) {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: init.method || 'GET',
    headers: init.headers || {},
  };
}

function performNativeRequest(url, init = {}) {
  const timeoutMs = Number(init.timeoutMs) > 0 ? Number(init.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const transport = getTransport(url);
  const options = createRequestOptions(url, init);
  return new Promise((resolve, reject) => {
    const request = transport.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          status: response.statusCode || 0,
          headers: response.headers || {},
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    if (timeoutMs > 0) {
      request.setTimeout(timeoutMs, () => {
        request.destroy(createProviderError('timeout', 'Request timed out.'));
      });
    }
    if (init.body) {
      request.write(init.body);
    }
    request.end();
  });
}

async function performRequest(url, init = {}, deps = {}) {
  if (typeof deps.requestImpl === 'function') {
    return deps.requestImpl({ url, ...init });
  }
  return performNativeRequest(url, init);
}

function parseRetryAfter(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  return 5000;
}

function shouldRetry(status) {
  return status === 429 || status === 503;
}

function isRetryableNetworkError(error) {
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code);
}

async function requestOnce(url, init = {}, deps = {}) {
  const response = await performRequest(url, init, deps);
  const status = Number(response?.status) || 0;
  const bodyText = typeof response?.bodyText === 'string'
    ? response.bodyText
    : typeof response?.body === 'string'
      ? response.body
      : response?.body ? String(response.body) : '';
  return {
    status,
    headers: response?.headers || {},
    bodyText,
    raw: response,
  };
}

export async function requestRaw(url, init = {}, deps = {}) {
  const maxRetries = Number.isFinite(Number(init.maxRetries)) ? Math.max(0, Number(init.maxRetries)) : 1;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      const response = await requestOnce(url, init, deps);
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      if (shouldRetry(response.status) && attempt < maxRetries) {
        const delayMs = parseRetryAfter(response.headers?.['retry-after'] || response.headers?.['Retry-After']);
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      const error = createProviderError('request_failed', `${init.method || 'GET'} ${url} failed (${response.status}): ${response.bodyText || 'empty response'}`);
      error.status = response.status;
      error.headers = response.headers;
      throw error;
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
      await sleep(1000);
      attempt += 1;
    }
  }

  throw lastError || createProviderError('request_failed', `Request failed: ${url}`);
}

export async function requestJson(url, init = {}, deps = {}) {
  const response = await requestRaw(url, init, deps);
  return {
    ...response,
    json: response.bodyText ? JSON.parse(response.bodyText) : null,
  };
}

function parseSSEBody(bodyText, onEvent) {
  const lines = String(bodyText || '').replaceAll('\r\n', '\n').split('\n');
  let eventName = 'message';
  const dataLines = [];

  const flush = () => {
    if (!dataLines.length) {
      eventName = 'message';
      return;
    }
    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      eventName = 'message';
      dataLines.length = 0;
      return;
    }
    onEvent({
      event: eventName,
      data,
    });
    eventName = 'message';
    dataLines.length = 0;
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
}

export async function requestSSE(url, init = {}, deps = {}, onEvent = () => {}) {
  const response = await requestRaw(url, {
    ...init,
    maxRetries: Number.isFinite(Number(init.maxRetries)) ? Number(init.maxRetries) : 1,
  }, deps);
  parseSSEBody(response.bodyText, onEvent);
  return response;
}

export function extractJSONLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
