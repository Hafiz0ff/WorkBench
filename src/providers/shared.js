import { TextDecoder } from 'node:util';

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => ({
      role: typeof message?.role === 'string' ? message.role : 'user',
      content: typeof message?.content === 'string' ? message.content : String(message?.content ?? ''),
    }))
    .filter((message) => message.content.length > 0 || message.role === 'system');
}

export function createProviderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function decodeChunkBuffer(buffer) {
  return new TextDecoder().decode(buffer);
}

export function extractLines(buffer, onLine) {
  let remaining = buffer;
  let newlineIndex = remaining.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = remaining.slice(0, newlineIndex).trim();
    if (line) {
      onLine(line);
    }
    remaining = remaining.slice(newlineIndex + 1);
    newlineIndex = remaining.indexOf('\n');
  }
  return remaining;
}

export async function withTimeout(task, timeoutMs, timeoutMessage) {
  let timer = null;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(createProviderError('timeout', timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
