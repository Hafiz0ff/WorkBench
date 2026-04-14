import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appendMessage } from '../../src/conversation.js';
import { createTask } from '../../src/tasks.js';
import { writeProvidersConfig } from '../../src/providers/index.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-task-history-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await writeProvidersConfig(root, {
    default: 'ollama',
    contextWindow: {
      historyMessages: 20,
      summarizeAfter: 50,
    },
    providers: {
      ollama: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        defaultModel: 'qwen2.5-coder:14b',
      },
    },
  });
  return root;
}

async function startOllamaMock() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(`${JSON.stringify({
        message: {
          content: JSON.stringify({
            message: 'Готово.',
            tool_calls: [],
          }),
        },
        done: true,
      })}\n`);
      return;
    }
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    host: `http://127.0.0.1:${port}`,
  };
}

async function runCliWithInput(args, { cwd, env, input }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    const chunks = Array.isArray(input) ? input : [input];
    let index = 0;
    const writeNext = () => {
      if (index >= chunks.length) {
        child.stdin.end();
        return;
      }
      child.stdin.write(chunks[index]);
      index += 1;
      if (index >= chunks.length) {
        setTimeout(() => child.stdin.end(), 100);
        return;
      }
      setTimeout(writeNext, 100);
    };
    setTimeout(writeNext, 50);
  });
}

test('task history, sessions, export, and continue commands use conversation history', async () => {
  const root = await createTempProject();
  const mock = await startOllamaMock();
  const task = await createTask(root, {
    title: 'Auth history',
    userRequest: 'Проверить историю задачи',
    summary: 'Проверка команд истории',
  });

  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Первый вопрос',
    timestamp: '2026-04-13T10:00:00.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(task.folderPath, {
    role: 'assistant',
    content: 'Первый ответ',
    timestamp: '2026-04-13T10:00:05.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Второй вопрос',
    timestamp: '2026-04-13T11:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: 'sess-20260413-b2',
  });

  const historyResult = await execFileAsync(process.execPath, [CLI_PATH, 'task', 'history', task.id], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(historyResult.stdout.toString(), /История задачи:/);
  assert.match(historyResult.stdout.toString(), /Первый вопрос/);
  assert.match(historyResult.stdout.toString(), /Сессий: 2/);

  const sessionResult = await execFileAsync(process.execPath, [CLI_PATH, 'task', 'sessions', task.id], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(sessionResult.stdout.toString(), /Сессии задачи:/);
  assert.match(sessionResult.stdout.toString(), /sess-20260413-a1/);
  assert.match(sessionResult.stdout.toString(), /sess-20260413-b2/);

  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'local-codex-task-export-'));
  const exportResult = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'export',
    task.id,
    '--format',
    'json',
    '--output',
    exportDir,
  ], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  const exportedPath = path.join(exportDir, `task-${task.slug}-history.json`);
  assert.match(exportResult.stdout.toString(), /История экспортирована:/);
  await assert.doesNotReject(() => stat(exportedPath));
  assert.match(await readFile(exportedPath, 'utf8'), /"messageCount": 3/);

  const clearResult = await execFileAsync(process.execPath, [
    CLI_PATH,
    'task',
    'history',
    task.id,
    '--clear',
    '--yes',
  ], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(clearResult.stdout.toString(), /История задачи очищена/);

  const emptyHistoryResult = await execFileAsync(process.execPath, [CLI_PATH, 'task', 'history', task.id], {
    cwd: root,
    env: { ...process.env, APP_LOCALE: 'ru' },
    maxBuffer: 1024 * 1024,
  });
  assert.match(emptyHistoryResult.stdout.toString(), /История пуста/);

  const continueTask = await createTask(root, {
    title: 'Auth continue',
    userRequest: 'Проверить продолжение истории',
    summary: 'Проверка continue',
  });
  await appendMessage(continueTask.folderPath, {
    role: 'user',
    content: 'Первый вопрос',
    timestamp: '2026-04-13T10:00:00.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(continueTask.folderPath, {
    role: 'assistant',
    content: 'Первый ответ',
    timestamp: '2026-04-13T10:00:05.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(continueTask.folderPath, {
    role: 'user',
    content: 'Второй вопрос',
    timestamp: '2026-04-13T11:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: 'sess-20260413-b2',
  });

  const mockImport = new URL('../../test/support/mock-provider-fetch.mjs', import.meta.url).href;
  await writeProvidersConfig(root, {
    default: 'ollama',
    contextWindow: {
      historyMessages: 20,
      summarizeAfter: 50,
    },
    providers: {
      ollama: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        defaultModel: 'qwen2.5-coder:14b',
      },
    },
  });

  const continueResult = await runCliWithInput([
    'task',
    'continue',
    continueTask.id,
  ], {
    cwd: root,
    env: {
      ...process.env,
      APP_LOCALE: 'ru',
      OLLAMA_HOST: mock.host,
    },
    input: ['Продолжить работу над задачей\n', '/exit\n'],
  });

  assert.equal(continueResult.code, 0);
  assert.match(continueResult.stdout, /Загружена история: 3 сообщений/);
  assert.match(continueResult.stdout, /Продолжаем задачу/);
  assert.match(continueResult.stdout, /Готово\./);
  const requestLog = await readFile(path.join(continueTask.folderPath, 'conversation.jsonl'), 'utf8');
  assert.match(requestLog, /Продолжить работу над задачей/);
  await new Promise((resolve) => mock.server.close(resolve));
});
