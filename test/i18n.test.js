import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTranslator, getDefaultLocale } from '../src/i18n.js';
import { scaffoldBuiltInRoles } from '../src/roles.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-i18n-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    type: 'module',
  }, null, 2));
  await scaffoldBuiltInRoles(root);
  return root;
}

test('Russian is the default locale and unknown locales fall back to Russian', async () => {
  assert.equal(getDefaultLocale(), 'ru');

  const defaultTranslator = await createTranslator();
  const fallbackTranslator = await createTranslator('zz');
  const englishTranslator = await createTranslator('en');

  assert.match(defaultTranslator('help.title'), /Локальный coding assistant/);
  assert.match(fallbackTranslator('help.title'), /Локальный coding assistant/);
  assert.match(englishTranslator('help.title'), /Local coding assistant/);
  assert.match(defaultTranslator('help.usage'), /app provider list/);
  assert.match(englishTranslator('help.usage'), /app provider list/);
  assert.match(defaultTranslator('help.usage'), /app task history/);
  assert.match(englishTranslator('help.usage'), /app task history/);
  assert.match(defaultTranslator('help.usage'), /app test run/);
  assert.match(englishTranslator('help.usage'), /app test run/);
  assert.match(defaultTranslator('extensions.installPreviewTitle'), /Предпросмотр расширения/);
  assert.match(englishTranslator('extensions.installPreviewTitle'), /Extension preview/);
  assert.match(defaultTranslator('provider.listTitle'), /Провайдеры LLM/);
  assert.match(englishTranslator('provider.listTitle'), /LLM providers/);
  assert.match(defaultTranslator('task.historyTitle', { id: 'task-1' }), /История задачи/);
  assert.match(englishTranslator('task.historyTitle', { id: 'task-1' }), /Task history/);
  assert.match(defaultTranslator('test.configTitle'), /Конфигурация тест-раннера/);
  assert.match(englishTranslator('test.configTitle'), /Test runner config/);
  assert.equal(fallbackTranslator('missing.key'), 'missing.key');
});

test('CLI help defaults to Russian', async () => {
  const result = await execFileAsync(process.execPath, [CLI_PATH, 'help'], {
    env: { ...process.env },
    maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout.toString(), /Локальный coding assistant/);
  assert.match(result.stdout.toString(), /Использование:/);
  assert.match(result.stdout.toString(), /app extensions install/);
});

test('new patch CLI output defaults to Russian', async () => {
  const root = await createTempProject();
  const result = await execFileAsync(process.execPath, [CLI_PATH, 'patch', 'status'], {
    cwd: root,
    env: { ...process.env },
    maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout.toString(), /Статус патча|Ожидающих изменений нет/);
});
