import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import { createTask, ensureTaskWorkspace } from '../src/tasks.js';
import {
  appendMessage,
  clearHistory,
  ensureConversationSummary,
  exportToJson,
  exportToMarkdown,
  listConversationStats,
  listSessions,
  readConversationSummary,
  readHistory,
  readRecent,
  readSession,
} from '../src/conversation.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-conversation-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return root;
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

test('conversation history appends, reads, and groups sessions', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Conversation flow',
    userRequest: 'Проверить историю диалога',
  });

  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Первое сообщение',
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
    confidence: 0.42,
    confidenceSource: 'logprobs',
  });
  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Второе сообщение',
    timestamp: '2026-04-13T11:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: 'sess-20260413-b2',
  });

  const history = await readHistory(task.folderPath);
  const recent = await readRecent(task.folderPath, 2);
  const session = await readSession(task.folderPath, 'sess-20260413-a1');
  const sessions = await listSessions(task.folderPath);
  const stats = await listConversationStats(task.folderPath);

  assert.equal(history.length, 3);
  assert.equal(recent.length, 2);
  assert.equal(session.length, 2);
  assert.equal(sessions.length, 2);
  assert.deepEqual(stats.providers, ['ollama', 'openai']);
  assert.equal(stats.messageCount, 3);
  assert.equal(stats.sessionCount, 2);
  assert.equal(history[0].content, 'Первое сообщение');
  assert.equal(history[2].sessionId, 'sess-20260413-b2');
  assert.equal(history[1].confidence, 0.42);
  assert.equal(history[1].confidenceSource, 'logprobs');
});

test('conversation summary generation writes markdown summary and exposes it', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Summary flow',
    userRequest: 'Проверить сводку',
  });

  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Нужно обновить auth flow.',
    timestamp: '2026-04-13T10:00:00.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(task.folderPath, {
    role: 'assistant',
    content: 'Сначала посмотрю текущую реализацию.',
    timestamp: '2026-04-13T10:00:05.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Добавь проверку токена.',
    timestamp: '2026-04-13T10:10:00.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-b2',
  });

  const provider = {
    name: 'ollama',
    async *chat() {
      yield '## Сводка\n- Нужно обновить auth flow.\n- Требуется проверка токена.';
    },
  };

  const result = await ensureConversationSummary(task.folderPath, {
    provider,
    model: 'qwen2.5-coder:14b',
    historyMessages: 2,
    summarizeAfter: 2,
    locale: 'ru',
  });

  const summary = await readConversationSummary(task.folderPath);
  const summaryPath = path.join(task.folderPath, 'conversation-summary.md');
  const summaryFile = await readText(summaryPath);

  assert.equal(result.summaryGenerated, true);
  assert.match(result.summary, /Сводка/);
  assert.match(summary, /Сводка/);
  assert.match(summaryFile, /generatedAt:/);
  assert.match(summaryFile, /messageCount: 3/);
});

test('conversation exports and clearing history work on disk', async () => {
  const root = await createTempProject();
  const task = await createTask(root, {
    title: 'Export flow',
    userRequest: 'Проверить экспорт истории',
  });

  await appendMessage(task.folderPath, {
    role: 'user',
    content: 'Сохранить историю.',
    timestamp: '2026-04-13T10:00:00.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });
  await appendMessage(task.folderPath, {
    role: 'assistant',
    content: 'История сохранена.',
    timestamp: '2026-04-13T10:00:05.000Z',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId: 'sess-20260413-a1',
  });

  const exportRoot = await mkdtemp(path.join(os.tmpdir(), 'local-codex-conversation-export-'));
  const markdownPath = path.join(exportRoot, 'history.md');
  const jsonPath = path.join(exportRoot, 'history.json');

  const markdown = await exportToMarkdown(task.folderPath, markdownPath);
  const json = await exportToJson(task.folderPath, jsonPath);

  assert.equal(markdown.path, markdownPath);
  assert.equal(json.path, jsonPath);
  assert.match(await readText(markdownPath), /Conversation history/);
  assert.match(await readText(jsonPath), /"messageCount": 2/);

  await clearHistory(task.folderPath);
  await assert.rejects(() => stat(path.join(task.folderPath, 'conversation.jsonl')));

  const clearedHistory = await readHistory(task.folderPath);
  const clearedStats = await listConversationStats(task.folderPath);
  assert.equal(clearedHistory.length, 0);
  assert.equal(clearedStats.messageCount, 0);
  assert.equal(clearedStats.sessionCount, 0);
});
