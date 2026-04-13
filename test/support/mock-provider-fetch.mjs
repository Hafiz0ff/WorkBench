const originalFetch = globalThis.fetch?.bind(globalThis);

function isOllamaLike(url) {
  return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.pathname === '/api/tags' || url.pathname === '/api/chat');
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'content-type': init.contentType || 'application/json',
    },
  });
}

function nextChatResponse() {
  if (!globalThis.__mockProviderChatResponses) {
    const rawList = process.env.MOCK_OLLAMA_CHAT_RESPONSES;
    if (rawList) {
      try {
        const parsed = JSON.parse(rawList);
        globalThis.__mockProviderChatResponses = Array.isArray(parsed) ? parsed.slice() : [String(rawList)];
      } catch {
        globalThis.__mockProviderChatResponses = [String(rawList)];
      }
    } else {
      globalThis.__mockProviderChatResponses = [process.env.MOCK_OLLAMA_CHAT_RESPONSE || '{"message":{"content":"hello"},"done":true}\n'];
    }
  }
  const queue = globalThis.__mockProviderChatResponses;
  return queue.length ? queue.shift() : '{"message":{"content":"hello"},"done":true}\n';
}

globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input.url);
  if (!isOllamaLike(requestUrl)) {
    if (typeof originalFetch === 'function') {
      return originalFetch(input, init);
    }
    throw new Error(`Unexpected fetch call: ${requestUrl.href}`);
  }

  if (requestUrl.pathname === '/api/tags') {
    const models = process.env.MOCK_OLLAMA_MODELS
      ? JSON.parse(process.env.MOCK_OLLAMA_MODELS)
      : [
        { name: 'qwen2.5-coder:14b' },
        { name: 'llama3.1:8b' },
      ];
    return jsonResponse({ models });
  }

  if (requestUrl.pathname === '/api/chat' && (init?.method || 'GET').toUpperCase() === 'POST') {
    return new Response(nextChatResponse(), {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson',
      },
    });
  }

  return jsonResponse({ error: 'not found' }, { status: 404 });
};
