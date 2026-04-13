import { spawn } from 'node:child_process';
import { evaluateCommandPolicy, readProjectPolicy, listAllowedShellCommandsFromPolicy } from './policy.js';

function truncateText(value, maxChars) {
  if (typeof value !== 'string') {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} characters]`;
}

function localizedMessage(t, key, values, fallback) {
  if (typeof t === 'function') {
    try {
      return t(key, values);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function runShellCommand(root, command, args = [], options = {}) {
  const policy = options.policy || await readProjectPolicy(root);
  const evaluation = evaluateCommandPolicy(policy, command, args);
  const t = options.t;

  if (evaluation.blocked) {
    return {
      ok: false,
      decision: 'blocked',
      category: evaluation.category,
      command,
      args,
      code: null,
      stdout: '',
      stderr: '',
      message: localizedMessage(
        t,
        'policy.commandBlocked',
        { command: [command, ...args].join(' '), reason: evaluation.reason },
        `Blocked command: ${[command, ...args].join(' ')} (${evaluation.reason})`,
      ),
      reason: evaluation.reason,
    };
  }

  if (evaluation.approvalRequired) {
    return {
      ok: false,
      decision: 'approval_required',
      category: evaluation.category,
      command,
      args,
      code: null,
      stdout: '',
      stderr: '',
      message: localizedMessage(
        t,
        'policy.commandApprovalRequired',
        { command: [command, ...args].join(' '), reason: evaluation.reason },
        `Approval required for command: ${[command, ...args].join(' ')} (${evaluation.reason})`,
      ),
      reason: evaluation.reason,
    };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeoutMs = options.timeoutMs || 20000;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Shell command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const maxChars = options.maxOutputChars || policy.maxCommandOutputChars;
      resolve({
        ok: code === 0,
        decision: 'allow',
        category: evaluation.category,
        command,
        args,
        code: code ?? 0,
        stdout: truncateText(stdout, maxChars),
        stderr: truncateText(stderr, maxChars),
        reason: evaluation.reason,
      });
    });
  });
}

export async function listAllowedShellCommands(projectRoot) {
  const policy = await readProjectPolicy(projectRoot);
  return listAllowedShellCommandsFromPolicy(policy);
}
