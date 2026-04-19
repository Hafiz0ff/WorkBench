import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { trackEvent } from './stats.js';
import { checkLimit, createBudgetError, trackUsage } from './budget.js';
import { readProjectPolicy } from './policy.js';

const CONVERSATION_FILE_NAME = 'conversation.jsonl';
const CONVERSATION_SUMMARY_FILE_NAME = 'conversation-summary.md';
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_SUMMARIZE_AFTER = 50;

function nowIso() {
  return new Date().toISOString();
}

function randomToken(length = 4) {
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0');
}

function formatDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function deriveProjectRootFromTaskDir(taskDir) {
  const root = normalizeTaskDir(taskDir);
  return path.resolve(root, '..', '..', '..', '..');
}

function estimateTokens(text) {
  const value = String(text || '');
  return Math.max(1, Math.ceil(value.length / 4));
}

function estimateMessageTokens(messages) {
  return estimateTokens(JSON.stringify(messages || []));
}

export function createSessionId(date = new Date()) {
  return `sess-${formatDateKey(date)}-${randomToken(6)}`;
}

export function createMessageId(date = new Date()) {
  return `msg-${date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomToken(4)}`;
}

function normalizeTaskDir(taskDir) {
  return normalizeRoot(taskDir);
}

function getConversationPath(taskDir) {
  return resolveWithinRoot(normalizeTaskDir(taskDir), CONVERSATION_FILE_NAME);
}

function getSummaryPath(taskDir) {
  return resolveWithinRoot(normalizeTaskDir(taskDir), CONVERSATION_SUMMARY_FILE_NAME);
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value || 'user';
}

function normalizeContent(content) {
  return String(content ?? '').trim();
}

function normalizeMessage(message) {
  const content = normalizeContent(message?.content);
  if (!content) {
    throw new Error('Conversation message content is required.');
  }
  const confidence = Number(message?.confidence?.score ?? message?.confidence);
  return {
    id: typeof message?.id === 'string' && message.id.trim() ? message.id.trim() : createMessageId(),
    role: normalizeRole(message?.role),
    content,
    timestamp: typeof message?.timestamp === 'string' && message.timestamp.trim() ? message.timestamp.trim() : nowIso(),
    provider: typeof message?.provider === 'string' && message.provider.trim() ? message.provider.trim() : null,
    model: typeof message?.model === 'string' && message.model.trim() ? message.model.trim() : null,
    sessionId: typeof message?.sessionId === 'string' && message.sessionId.trim() ? message.sessionId.trim() : null,
    tokens: message?.tokens && typeof message.tokens === 'object' ? message.tokens : undefined,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
    confidenceSource: typeof message?.confidenceSource === 'string' && message.confidenceSource.trim() ? message.confidenceSource.trim() : null,
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(filePath) {
  await fs.mkdir(filePath, { recursive: true });
}

export async function ensureConversationFile(taskDir) {
  const root = normalizeTaskDir(taskDir);
  const filePath = getConversationPath(root);
  await ensureDirectory(path.dirname(filePath));
  if (!(await fileExists(filePath))) {
    await fs.writeFile(filePath, '', 'utf8');
  }
  return filePath;
}

export async function appendMessage(taskDir, message) {
  const filePath = await ensureConversationFile(taskDir);
  const record = normalizeMessage(message);
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

async function readLines(filePath) {
  if (!(await fileExists(filePath))) {
    return [];
  }
  const content = await fs.readFile(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function readHistory(taskDir) {
  const filePath = getConversationPath(taskDir);
  const lines = await readLines(filePath);
  const messages = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
        messages.push({
          id: typeof parsed.id === 'string' ? parsed.id : createMessageId(),
          role: normalizeRole(parsed.role),
          content: parsed.content,
          timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : nowIso(),
          provider: typeof parsed.provider === 'string' ? parsed.provider : null,
          model: typeof parsed.model === 'string' ? parsed.model : null,
          sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
          tokens: parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : undefined,
          confidence: Number.isFinite(Number(parsed.confidence?.score ?? parsed.confidence)) ? Number(parsed.confidence?.score ?? parsed.confidence) : undefined,
          confidenceSource: typeof parsed.confidenceSource === 'string' ? parsed.confidenceSource : null,
        });
      }
    } catch {
      continue;
    }
  }
  return messages;
}

export async function readRecent(taskDir, limit = DEFAULT_HISTORY_LIMIT) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : DEFAULT_HISTORY_LIMIT;
  const history = await readHistory(taskDir);
  return safeLimit === 0 ? [] : history.slice(-safeLimit);
}

export async function readSession(taskDir, sessionId) {
  const target = String(sessionId || '').trim();
  if (!target) {
    return [];
  }
  const history = await readHistory(taskDir);
  return history.filter((message) => message.sessionId === target);
}

export async function listSessions(taskDir) {
  const history = await readHistory(taskDir);
  const sessions = new Map();

  for (const message of history) {
    if (!message.sessionId) {
      continue;
    }
    const entry = sessions.get(message.sessionId) || {
      sessionId: message.sessionId,
      startedAt: message.timestamp,
      lastMessageAt: message.timestamp,
      messageCount: 0,
      providers: new Set(),
      models: new Set(),
    };
    entry.startedAt = entry.startedAt < message.timestamp ? entry.startedAt : message.timestamp;
    entry.lastMessageAt = entry.lastMessageAt > message.timestamp ? entry.lastMessageAt : message.timestamp;
    entry.messageCount += 1;
    if (message.provider) {
      entry.providers.add(message.provider);
    }
    if (message.model) {
      entry.models.add(message.model);
    }
    sessions.set(message.sessionId, entry);
  }

  return [...sessions.values()]
    .map((entry) => ({
      sessionId: entry.sessionId,
      startedAt: entry.startedAt,
      lastMessageAt: entry.lastMessageAt,
      messageCount: entry.messageCount,
      providers: [...entry.providers],
      models: [...entry.models],
    }))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

async function parseSummaryDocument(taskDir) {
  const filePath = getSummaryPath(taskDir);
  if (!(await fileExists(filePath))) {
    return null;
  }
  const raw = await fs.readFile(filePath, 'utf8');
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      raw,
      metadata: {},
      body: raw.trim(),
    };
  }
  const metadataLines = frontmatterMatch[1].split(/\r?\n/);
  const metadata = {};
  for (const line of metadataLines) {
    const [key, ...rest] = line.split(':');
    if (!key || !rest.length) {
      continue;
    }
    metadata[key.trim()] = rest.join(':').trim();
  }
  return {
    raw,
    metadata,
    body: frontmatterMatch[2].trim(),
  };
}

async function writeSummaryDocument(taskDir, metadata, body) {
  const filePath = getSummaryPath(taskDir);
  await ensureDirectory(path.dirname(filePath));
  const lines = [
    '---',
    `generatedAt: ${metadata.generatedAt || nowIso()}`,
    `messageCount: ${metadata.messageCount ?? 0}`,
    `sessionCount: ${metadata.sessionCount ?? 0}`,
    `provider: ${metadata.provider || ''}`,
    `model: ${metadata.model || ''}`,
    '---',
    '',
    body.trim(),
    '',
  ];
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

function formatTranscript(history) {
  return history
    .map((message, index) => [
      `${index + 1}. ${message.role.toUpperCase()} (${message.timestamp})`,
      message.content,
    ].join('\n'))
    .join('\n\n');
}

async function generateSummaryText({ taskDir, history, provider, model, locale = 'ru' }) {
  const transcript = formatTranscript(history);
  const systemPrompt = locale === 'en'
    ? 'Summarize the task conversation in concise Markdown. Capture goals, decisions, open questions, and next steps. Keep it short and practical.'
    : 'Сожми историю диалога задачи в краткий Markdown. Сохрани цели, решения, открытые вопросы и следующие шаги. Текст должен быть коротким и практичным.';
  const userPrompt = locale === 'en'
    ? `Conversation transcript:\n\n${transcript}`
    : `Транскрипт диалога:\n\n${transcript}`;
  const projectRoot = deriveProjectRootFromTaskDir(taskDir);

  if (provider && typeof provider.chat === 'function') {
    try {
      const budgetCheck = await checkLimit(projectRoot, provider?.name || 'unknown');
      const policy = await readProjectPolicy(projectRoot).catch(() => null);
      if (!budgetCheck.ok && policy?.budget?.onExceed === 'block') {
        throw createBudgetError('Token budget exceeded.', budgetCheck.exceeded);
      }
      let content = '';
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      for await (const chunk of provider.chat(messages, { model })) {
        content += chunk;
      }
      const trimmed = content.trim();
      if (trimmed) {
        void trackUsage(projectRoot, {
          provider: provider?.name || 'unknown',
          model: model || provider?.defaultModel || null,
          promptTokens: estimateMessageTokens(messages),
          completionTokens: estimateTokens(trimmed),
          estimated: true,
        }).catch(() => {});
        void trackEvent(projectRoot, {
          type: 'provider.request',
          provider: provider?.name || 'unknown',
          model: model || provider?.defaultModel || null,
          promptTokens: estimateMessageTokens(messages),
          completionTokens: estimateTokens(trimmed),
        }).catch(() => {});
        return trimmed;
      }
    } catch {
      // Fallback below.
    }
  }

  const recent = history.slice(-DEFAULT_HISTORY_LIMIT);
  const lines = [
    locale === 'en' ? '# Conversation summary' : '# Сводка диалога',
    '',
    locale === 'en' ? '## Recent messages' : '## Последние сообщения',
    ...recent.map((message) => `- ${message.role}: ${message.content.slice(0, 160)}`),
  ];
  return lines.join('\n');
}

export async function readConversationSummary(taskDir) {
  const parsed = await parseSummaryDocument(taskDir);
  return parsed?.body || '';
}

export async function clearHistory(taskDir) {
  const root = normalizeTaskDir(taskDir);
  const conversationPath = getConversationPath(root);
  const summaryPath = getSummaryPath(root);
  if (await fileExists(conversationPath)) {
    await fs.rm(conversationPath, { force: true });
  }
  if (await fileExists(summaryPath)) {
    await fs.rm(summaryPath, { force: true });
  }
}

export async function listConversationStats(taskDir) {
  const history = await readHistory(taskDir);
  const sessions = await listSessions(taskDir);
  const providers = [...new Set(history.map((message) => message.provider).filter(Boolean))];
  return {
    messageCount: history.length,
    sessionCount: sessions.length,
    providers,
    recentMessages: history.slice(-DEFAULT_HISTORY_LIMIT),
    sessions,
  };
}

export async function exportToMarkdown(taskDir, outputPath) {
  const root = normalizeTaskDir(taskDir);
  const history = await readHistory(root);
  const sessions = await listSessions(root);
  const lines = [
    '# Conversation history',
    '',
    `- Task dir: \`${root}\``,
    `- Messages: ${history.length}`,
    `- Sessions: ${sessions.length}`,
    '',
  ];

  for (const session of sessions) {
    lines.push(`## ${session.sessionId}`);
    lines.push(`- Started at: ${session.startedAt}`);
    lines.push(`- Last message: ${session.lastMessageAt}`);
    lines.push(`- Messages: ${session.messageCount}`);
    lines.push(`- Providers: ${session.providers.join(', ') || '—'}`);
    lines.push(`- Models: ${session.models.join(', ') || '—'}`);
    lines.push('');
    for (const message of history.filter((entry) => entry.sessionId === session.sessionId)) {
      lines.push(`### ${message.role} @ ${message.timestamp}`);
      lines.push(message.content);
      lines.push('');
    }
  }

  const target = normalizeRoot(outputPath);
  await ensureDirectory(path.dirname(target));
  await fs.writeFile(target, `${lines.join('\n').trimEnd()}\n`, 'utf8');
  return {
    path: target,
    messageCount: history.length,
    sessionCount: sessions.length,
  };
}

export async function exportToJson(taskDir, outputPath) {
  const root = normalizeTaskDir(taskDir);
  const history = await readHistory(root);
  const sessions = await listSessions(root);
  const target = normalizeRoot(outputPath);
  await ensureDirectory(path.dirname(target));
  await fs.writeFile(target, `${JSON.stringify({
    taskDir: root,
    exportedAt: nowIso(),
    messageCount: history.length,
    sessionCount: sessions.length,
    sessions,
    messages: history,
  }, null, 2)}\n`, 'utf8');
  return {
    path: target,
    messageCount: history.length,
    sessionCount: sessions.length,
  };
}

export async function ensureConversationSummary(taskDir, {
  provider = null,
  model = null,
  historyMessages = DEFAULT_HISTORY_LIMIT,
  summarizeAfter = DEFAULT_SUMMARIZE_AFTER,
  locale = 'ru',
} = {}) {
  const root = normalizeTaskDir(taskDir);
  const history = await readHistory(root);
  const totalMessages = history.length;
  const recentMessages = history.slice(-Math.max(0, historyMessages));
  const summaryPath = getSummaryPath(root);
  const currentSummary = await parseSummaryDocument(root);

  if (totalMessages <= summarizeAfter) {
    return {
      summary: currentSummary?.body || '',
      summaryPath: currentSummary ? summaryPath : null,
      summaryGenerated: false,
      totalMessages,
      recentMessages,
      sessionCount: (await listSessions(root)).length,
    };
  }

  if (currentSummary?.metadata?.messageCount && Number(currentSummary.metadata.messageCount) === totalMessages) {
    return {
      summary: currentSummary.body,
      summaryPath,
      summaryGenerated: false,
      totalMessages,
      recentMessages,
      sessionCount: (await listSessions(root)).length,
    };
  }

  const olderMessages = history.slice(0, Math.max(0, totalMessages - recentMessages.length));
  const summaryText = await generateSummaryText({
    taskDir: root,
    history: olderMessages.length ? olderMessages : history,
    provider,
    model,
    locale,
  });
  await writeSummaryDocument(root, {
    generatedAt: nowIso(),
    messageCount: totalMessages,
    sessionCount: (await listSessions(root)).length,
    provider: provider?.name || null,
    model: model || null,
  }, summaryText);

  return {
    summary: summaryText,
    summaryPath,
    summaryGenerated: true,
    totalMessages,
    recentMessages,
    sessionCount: (await listSessions(root)).length,
  };
}

export async function prepareConversationContext(taskDir, options = {}) {
  return ensureConversationSummary(taskDir, options);
}
