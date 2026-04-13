import { getDefaultPolicy } from './policy.js';

export const BASE_SYSTEM_INSTRUCTIONS = [
  'Ты локальный coding assistant и работаешь только внутри одного проекта за раз.',
  'Уважай выбранный корень проекта и никогда не предлагай действия вне его.',
  'Используй инструменты только тогда, когда они уменьшают неопределенность или заметно улучшают результат.',
  'Сначала просматривай файлы, потом редактируй их.',
  'Предпочитай небольшие безопасные изменения и явно описывай компромиссы.',
  'Держи ответы конкретными и привязанными к состоянию репозитория.',
].join('\n');

function section(label, content) {
  return `${label}\n${content.trim()}`;
}

function renderRoleLayer(roleProfile) {
  const lines = [
    `Имя: ${roleProfile.name}`,
    `Описание: ${roleProfile.description}`,
    '',
    'Цели:',
    ...roleProfile.goals.map((item) => `- ${item}`),
    '',
    'Поведенческие правила:',
    ...roleProfile.behavioralRules.map((item) => `- ${item}`),
    '',
    'Рекомендации по инструментам:',
    ...roleProfile.toolUsageGuidance.map((item) => `- ${item}`),
    '',
    'Стиль ответа:',
    ...roleProfile.outputStyle.map((item) => `- ${item}`),
    '',
    'Делай:',
    ...roleProfile.do.map((item) => `- ${item}`),
    '',
    'Не делай:',
    ...roleProfile.dont.map((item) => `- ${item}`),
  ];
  return lines.join('\n');
}

function renderMemoryLayer(memorySummary) {
  return memorySummary?.trim() || 'Память проекта пока не сформирована.';
}

function renderTaskContextLayer(taskContext) {
  return taskContext?.trim() || 'Текущий контекст задачи пока не задан.';
}

function renderConversationSummaryLayer(conversationSummary) {
  return conversationSummary?.trim() || 'Краткая сводка истории диалога пока не сформирована.';
}

function renderTaskInstructionLayer(taskInstruction) {
  return taskInstruction?.trim() || 'Инструкция для текущей задачи не задана.';
}

function renderExtensionPromptsLayer(extensionPrompts) {
  if (!Array.isArray(extensionPrompts) || extensionPrompts.length === 0) {
    return 'Подключенных пакетов промптов пока нет.';
  }
  return extensionPrompts.map((pack) => {
    const header = pack?.name ? `# ${pack.name}` : '# prompt pack';
    const body = typeof pack?.content === 'string' ? pack.content.trim() : '';
    return [header, body || '—'].join('\n');
  }).join('\n\n');
}

async function resolveAllowedShellCommands(projectRoot, allowedShellCommands) {
  if (Array.isArray(allowedShellCommands)) {
    return allowedShellCommands;
  }
  if (allowedShellCommands && typeof allowedShellCommands.then === 'function') {
    return await allowedShellCommands;
  }
  if (typeof allowedShellCommands === 'function') {
    return allowedShellCommands(projectRoot);
  }
  return getDefaultPolicy().allowedCommands;
}

export async function composePromptLayers({
  baseInstructions = BASE_SYSTEM_INSTRUCTIONS,
  roleProfile,
  memorySummary,
  taskContext,
  conversationSummary,
  extensionPrompts,
  taskInstruction,
  allowedShellCommands,
  projectRoot,
}) {
  if (!roleProfile) {
    throw new Error('A role profile is required to compose a prompt.');
  }

  const allowedCommands = await resolveAllowedShellCommands(projectRoot, allowedShellCommands);

  const layers = [
    {
      key: 'base',
      title: 'БАЗОВЫЕ СИСТЕМНЫЕ ИНСТРУКЦИИ',
      content: [
        baseInstructions.trim(),
        '',
        `Доступные shell-команды: ${allowedCommands.join(', ')}`,
        projectRoot ? `Корень проекта: ${projectRoot}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      key: 'role',
      title: `ПРОФИЛЬ РОЛИ: ${roleProfile.name}`,
      content: renderRoleLayer(roleProfile),
    },
    {
      key: 'memory',
      title: 'ПАМЯТЬ ПРОЕКТА',
      content: renderMemoryLayer(memorySummary),
    },
    {
      key: 'extensions',
      title: 'ПОДКЛЮЧЕННЫЕ ПАКЕТЫ ПРОМПТОВ',
      content: renderExtensionPromptsLayer(extensionPrompts),
    },
    {
      key: 'taskContext',
      title: 'КОНТЕКСТ ТЕКУЩЕЙ ЗАДАЧИ',
      content: renderTaskContextLayer(taskContext),
    },
    {
      key: 'conversationSummary',
      title: 'КРАТКАЯ СВОДКА ИСТОРИИ ДИАЛОГА',
      content: renderConversationSummaryLayer(conversationSummary),
    },
    {
      key: 'taskInstruction',
      title: 'ИНСТРУКЦИЯ ТЕКУЩЕЙ ЗАДАЧИ',
      content: renderTaskInstructionLayer(taskInstruction),
    },
  ];

  const finalPrompt = [
    section('=== БАЗОВЫЕ СИСТЕМНЫЕ ИНСТРУКЦИИ ===', layers[0].content),
    section('=== ПРОФИЛЬ РОЛИ ===', layers[1].content),
    section('=== ПАМЯТЬ ПРОЕКТА ===', layers[2].content),
    section('=== ПОДКЛЮЧЕННЫЕ ПАКЕТЫ ПРОМПТОВ ===', layers[3].content),
    section('=== КОНТЕКСТ ТЕКУЩЕЙ ЗАДАЧИ ===', layers[4].content),
    section('=== КРАТКАЯ СВОДКА ИСТОРИИ ДИАЛОГА ===', layers[5].content),
    section('=== ИНСТРУКЦИЯ ТЕКУЩЕЙ ЗАДАЧИ ===', layers[6].content),
  ].join('\n\n');

  return {
    layers,
    finalPrompt,
  };
}

export function formatPromptInspection(composition) {
  const parts = [];
  for (const layer of composition.layers) {
    parts.push(`=== ${layer.title} ===`);
    parts.push(layer.content.trim());
    parts.push('');
  }
  parts.push('=== ИТОГОВЫЙ ПРОМПТ ===');
  parts.push(composition.finalPrompt.trim());
  parts.push('');
  return parts.join('\n');
}
