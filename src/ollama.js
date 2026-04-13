const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

function getOllamaBaseUrl() {
  return process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

export async function listModels() {
  const data = await fetchJson(`${getOllamaBaseUrl()}/api/tags`);
  const models = Array.isArray(data.models) ? data.models : [];
  return models.map((model) => ({
    name: model.name,
    size: model.size,
    modifiedAt: model.modified_at,
  }));
}

export async function chat({ model, messages, options }) {
  const data = await fetchJson(`${getOllamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options,
    }),
  });

  return data?.message?.content || '';
}
