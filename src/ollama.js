import { createProvider as createOllamaProvider } from './providers/ollama.js';

const defaultProvider = createOllamaProvider({});

export async function* chat({ model, messages, options } = {}) {
  yield* defaultProvider.chat(messages || [], {
    ...(options || {}),
    model,
  });
}

export async function listModels() {
  return defaultProvider.listModels();
}

export async function healthCheck() {
  return defaultProvider.healthCheck();
}

export { createOllamaProvider };
