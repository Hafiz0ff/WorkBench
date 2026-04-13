import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { scaffoldBuiltInRoles } from '../src/roles.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-cli-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await scaffoldBuiltInRoles(root);
  return root;
}

async function runCli(args, cwd) {
  try {
    const result = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env },
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.toString();
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : '';
    const stderr = error.stderr ? error.stderr.toString() : '';
    throw new Error(`${error.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}

test('roles use persists the selected role and roles current reports it', async () => {
  const root = await createTempProject();

  const useOutput = await runCli(['roles', 'use', 'software-architect'], root);
  assert.match(useOutput, /Активная роль установлена: software-architect/);

  const currentOutput = await runCli(['roles', 'current'], root);
  assert.match(currentOutput, /Активная роль: software-architect/);
  assert.match(currentOutput, /software-architect\.md/);
});

test('prompt inspect prints the composed prompt layers', async () => {
  const root = await createTempProject();

  const output = await runCli(['prompt', 'inspect', '--role', 'designer', '--task', 'Review the dashboard hierarchy'], root);
  assert.match(output, /=== ПРОФИЛЬ РОЛИ: designer ===/);
  assert.match(output, /=== ПАМЯТЬ ПРОЕКТА ===/);
  assert.match(output, /=== КОНТЕКСТ ТЕКУЩЕЙ ЗАДАЧИ ===/);
  assert.match(output, /=== ИНСТРУКЦИЯ ТЕКУЩЕЙ ЗАДАЧИ ===/);
  assert.match(output, /Review the dashboard hierarchy/);
  assert.match(output, /=== ИТОГОВЫЙ ПРОМПТ ===/);
});
