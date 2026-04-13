import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chat, listModels } from './ollama.js';
import { readProjectFile, writeProjectFile, listProjectFiles } from './project.js';
import { listAllowedShellCommands, runShellCommand } from './shell.js';

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
  return trimmed;
}

function parseAssistantEnvelope(text) {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return {
      message: text.trim(),
      toolCalls: [],
    };
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      toolCalls: toolCalls
        .map((call) => ({
          tool: call.tool || call.name,
          args: call.args || call.arguments || {},
        }))
        .filter((call) => typeof call.tool === 'string'),
    };
  } catch {
    return {
      message: text.trim(),
      toolCalls: [],
    };
  }
}

function formatToolError(t, error) {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  switch (error.code) {
    case 'POLICY_BLOCKED':
      return t ? t('policy.pathBlocked', { reason: error.message }) : error.message;
    case 'POLICY_APPROVAL_REQUIRED':
      return t ? t('policy.pathApprovalRequired', { reason: error.message }) : error.message;
    default:
      return error.message || String(error);
  }
}

async function executeToolCall(root, call, { policy, t, taskTools } = {}) {
  switch (call.tool) {
    case 'list_files':
      return await listProjectFiles(root, call.args?.depth ?? 3);
    case 'read_file':
      try {
        return await readProjectFile(root, call.args?.path, call.args?.maxChars ?? 20000, { policy });
      } catch (error) {
        return {
          ok: false,
          message: formatToolError(t, error),
        };
      }
    case 'write_file':
      try {
        return await writeProjectFile(root, call.args?.path, call.args?.content ?? '', {
          policy,
          taskId: taskTools?.currentTaskId || null,
          role: taskTools?.currentRole || null,
          model: taskTools?.currentModel || null,
          summary: call.args?.summary || call.args?.path || 'file change',
          validationCommands: call.args?.validationCommands || [],
        });
      } catch (error) {
        return {
          ok: false,
          message: formatToolError(t, error),
        };
      }
    case 'run_shell':
      return await runShellCommand(root, call.args?.command, call.args?.args ?? [], { policy, t });
    case 'list_models':
      return await listModels();
    case 'task_note':
      return {
        ok: false,
        message: 'Для task_note нужен hook добавления заметок из CLI-слоя.',
      };
    default:
      throw new Error(`Неизвестный инструмент: ${call.tool}`);
  }
}

function formatToolResult(call, result) {
  return [
    `Инструмент: ${call.tool}`,
    `Аргументы: ${JSON.stringify(call.args ?? {})}`,
    `Результат: ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`,
  ].join('\n');
}

async function runModelRound({ model, messages }) {
  const content = await chat({
    model,
    messages,
  });
  return parseAssistantEnvelope(content);
}

export async function runInteractiveAgent({
  root,
  model,
  composePromptForTask,
  taskTools = {},
  policy,
  t,
  promptLabel = 'агент> ',
  exitHint = 'Введите /exit, чтобы выйти.',
  helpHint = 'Команды: /exit, /help',
}) {
  const rl = readline.createInterface({ input, output });
  const history = [];

  console.log(t ? t('agent.projectRoot', { path: root }) : `Корень проекта: ${root}`);
  console.log(t ? t('agent.model', { model }) : `Модель: ${model}`);
  console.log(exitHint);

  while (true) {
    const userInput = await rl.question(promptLabel);
    const trimmed = userInput.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') {
      break;
    }

    if (trimmed === '/help') {
      console.log(helpHint);
      continue;
    }

    const composition = await composePromptForTask(trimmed);
    const messages = [
      { role: 'system', content: composition.finalPrompt },
      ...history,
      { role: 'user', content: trimmed },
    ];

    let lastAssistantMessage = '';
    let rounds = 0;
    const turnToolResults = [];

    while (rounds < 8) {
      rounds += 1;
      const assistant = await runModelRound({ model, messages });
      lastAssistantMessage = assistant.message || '';
      if (assistant.message) {
        console.log(`\n${assistant.message}\n`);
      }

      if (!assistant.toolCalls.length) {
        messages.push({ role: 'assistant', content: assistant.message || lastAssistantMessage });
        break;
      }

      messages.push({
        role: 'assistant',
        content: JSON.stringify({
          message: assistant.message,
          tool_calls: assistant.toolCalls,
        }),
      });

      for (const call of assistant.toolCalls) {
        let result;
        if (call.tool === 'task_note' && typeof taskTools.appendNote === 'function') {
          const targetTaskId = call.args?.taskId || taskTools.currentTaskId || null;
          if (!targetTaskId) {
            throw new Error('task_note requires an active task.');
          }
          result = await taskTools.appendNote({
            taskId: targetTaskId,
            kind: call.args?.kind || 'note',
            text: call.args?.text || '',
            source: 'agent',
          });
        } else {
          result = await executeToolCall(root, call, { policy, t, taskTools });
        }
        turnToolResults.push({ call, result });
        const toolMessage = formatToolResult(call, result);
        console.log(toolMessage);
        messages.push({
          role: 'user',
          content: `Tool result for ${call.tool}:\n${toolMessage}`,
        });
      }
    }

    history.length = 0;
    history.push(...messages.slice(1));

    if (typeof taskTools.onTurnComplete === 'function') {
      await taskTools.onTurnComplete({
        userInput: trimmed,
        assistantMessage: lastAssistantMessage,
        toolResults: turnToolResults,
      });
    }
  }

  rl.close();
}
