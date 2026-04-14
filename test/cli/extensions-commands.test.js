import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI = path.join(process.cwd(), 'src', 'cli.js');

async function createProjectRoot(version = '2.3.0') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-extensions-'));
  await fs.mkdir(path.join(root, '.local-codex', 'extensions'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'workbench-cli-extensions-test',
    version,
    type: 'module',
  }, null, 2));
  return root;
}

async function writeLocalExtension(root, name, manifest, indexJs) {
  const directory = path.join(root, '.local-codex', 'extensions', name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'workbench.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(directory, 'index.js'), `${indexJs.trimEnd()}\n`);
  return directory;
}

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('extension CLI scaffolds, lists, inspects, toggles, and removes local extensions', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-extensions-home-'));
  const env = { WORKBENCH_HOME: workbenchHome };

  try {
    const scaffold = runCli(['extensions', 'scaffold', 'my-ext', '--hooks', 'pre-patch,post-patch'], { cwd: root, env });
    assert.equal(scaffold.status, 0);
    assert.match(scaffold.stdout, /my-ext|расширен/i);

    const directory = path.join(root, '.local-codex', 'extensions', 'my-ext');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'workbench.json'), 'utf8'));
    assert.equal(manifest.name, 'my-ext');
    assert.deepEqual(manifest.hooks, ['pre-patch', 'post-patch']);
    assert.ok(await fs.stat(path.join(directory, 'index.js')));
    assert.ok(await fs.stat(path.join(directory, 'README.md')));
    assert.ok(await fs.stat(path.join(directory, 'package.json')));

    const list = runCli(['extensions', 'list'], { cwd: root, env });
    assert.equal(list.status, 0);
    assert.match(list.stdout, /my-ext/);
    assert.match(list.stdout, /pre-patch, post-patch/);

    const info = runCli(['extensions', 'info', 'my-ext'], { cwd: root, env });
    assert.equal(info.status, 0);
    assert.match(info.stdout, /my-ext|Расширение/i);
    assert.match(info.stdout, /pre-patch, post-patch/);

    const disable = runCli(['extensions', 'disable', 'my-ext'], { cwd: root, env });
    assert.equal(disable.status, 0);
    let updated = JSON.parse(await fs.readFile(path.join(directory, 'workbench.json'), 'utf8'));
    assert.equal(updated.enabled, false);

    const enable = runCli(['extensions', 'enable', 'my-ext'], { cwd: root, env });
    assert.equal(enable.status, 0);
    updated = JSON.parse(await fs.readFile(path.join(directory, 'workbench.json'), 'utf8'));
    assert.equal(updated.enabled, true);

    const remove = runCli(['extensions', 'remove', 'my-ext', '--confirm'], { cwd: root, env });
    assert.equal(remove.status, 0);
    await assert.rejects(() => fs.stat(directory));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workbenchHome, { recursive: true, force: true });
  }
});

test('extension CLI scaffold supports global installation', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-extensions-home-'));
  const env = { WORKBENCH_HOME: workbenchHome };

  try {
    const scaffold = runCli(['extensions', 'scaffold', 'global-ext', '--global', '--hooks', 'pre-task'], { cwd: root, env });
    assert.equal(scaffold.status, 0);
    const directory = path.join(workbenchHome, 'extensions', 'global-ext');
    assert.ok(await fs.stat(directory));
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'workbench.json'), 'utf8'));
    assert.equal(manifest.name, 'global-ext');
    assert.deepEqual(manifest.hooks, ['pre-task']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workbenchHome, { recursive: true, force: true });
  }
});

test('app ext dispatches custom plugin commands', async () => {
  const root = await createProjectRoot();
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-extensions-home-'));
  const env = { WORKBENCH_HOME: workbenchHome };

  try {
    await writeLocalExtension(root, 'command-plugin', {
      name: 'command-plugin',
      version: '1.0.0',
      description: 'Registers a command.',
      author: 'Codex',
      hooks: [],
      commands: ['echo-plugin'],
      permissions: [],
      minWorkbenchVersion: '0.0.0',
      enabled: true,
    }, `
      export default function register(api) {
        api.registerCommand('echo-plugin', async (args) => \`echo:\${args.join(',')}\`);
      }
    `);

    const result = runCli(['ext', 'echo-plugin', 'a', 'b'], { cwd: root, env });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /echo:a,b/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workbenchHome, { recursive: true, force: true });
  }
});
