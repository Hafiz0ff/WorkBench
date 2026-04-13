import test from 'node:test';
import assert from 'node:assert/strict';
import { composePromptLayers, formatPromptInspection } from '../src/prompt-composer.js';

const roleProfile = {
  name: 'software-architect',
  description: 'System design lead.',
  goals: ['Clarify boundaries.', 'Plan migration paths.'],
  behavioralRules: ['Think in layers.', 'Call out tradeoffs.'],
  toolUsageGuidance: ['Inspect structure first.'],
  outputStyle: ['Structured and concise.'],
  do: ['Do sequence the work.'],
  dont: ['Do not over-abstract.'],
};

test('composes prompt layers in the expected order', async () => {
  const composition = await composePromptLayers({
    roleProfile,
    memorySummary: 'Project memory summary.',
    taskContext: 'Task context summary.',
    conversationSummary: 'Conversation summary.',
    taskInstruction: 'Review the API layer.',
    allowedShellCommands: ['git status', 'ls'],
    projectRoot: '/tmp/project',
  });

  assert.deepEqual(composition.layers.map((layer) => layer.key), ['base', 'role', 'memory', 'extensions', 'taskContext', 'conversationSummary', 'taskInstruction']);
  const baseIndex = composition.finalPrompt.indexOf('=== БАЗОВЫЕ СИСТЕМНЫЕ ИНСТРУКЦИИ ===');
  const roleIndex = composition.finalPrompt.indexOf('=== ПРОФИЛЬ РОЛИ ===');
  const memoryIndex = composition.finalPrompt.indexOf('=== ПАМЯТЬ ПРОЕКТА ===');
  const extensionsIndex = composition.finalPrompt.indexOf('=== ПОДКЛЮЧЕННЫЕ ПАКЕТЫ ПРОМПТОВ ===');
  const taskContextIndex = composition.finalPrompt.indexOf('=== КОНТЕКСТ ТЕКУЩЕЙ ЗАДАЧИ ===');
  const conversationIndex = composition.finalPrompt.indexOf('=== КРАТКАЯ СВОДКА ИСТОРИИ ДИАЛОГА ===');
  const taskIndex = composition.finalPrompt.indexOf('=== ИНСТРУКЦИЯ ТЕКУЩЕЙ ЗАДАЧИ ===');
  assert.ok(baseIndex < roleIndex && roleIndex < memoryIndex && memoryIndex < extensionsIndex && extensionsIndex < taskContextIndex && taskContextIndex < conversationIndex && conversationIndex < taskIndex);
  assert.match(composition.finalPrompt, /Review the API layer\./);
});

test('formats a clearly separated prompt inspection view', async () => {
  const composition = await composePromptLayers({
    roleProfile,
    memorySummary: 'Project memory summary.',
    taskContext: 'Task context summary.',
    conversationSummary: 'Conversation summary.',
    taskInstruction: 'Fix the test.',
    allowedShellCommands: ['git status', 'ls'],
    projectRoot: '/tmp/project',
  });

  const output = formatPromptInspection(composition);
  assert.match(output, /=== БАЗОВЫЕ СИСТЕМНЫЕ ИНСТРУКЦИИ ===/);
  assert.match(output, /=== ПРОФИЛЬ РОЛИ: software-architect ===/);
  assert.match(output, /=== ПАМЯТЬ ПРОЕКТА ===/);
  assert.match(output, /=== ПОДКЛЮЧЕННЫЕ ПАКЕТЫ ПРОМПТОВ ===/);
  assert.match(output, /=== КОНТЕКСТ ТЕКУЩЕЙ ЗАДАЧИ ===/);
  assert.match(output, /=== КРАТКАЯ СВОДКА ИСТОРИИ ДИАЛОГА ===/);
  assert.match(output, /=== ИНСТРУКЦИЯ ТЕКУЩЕЙ ЗАДАЧИ ===/);
  assert.match(output, /=== ИТОГОВЫЙ ПРОМПТ ===/);
});
