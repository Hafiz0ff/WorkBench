import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI = path.join(process.cwd(), 'src', 'cli.js');

async function createProjectRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-server-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'workbench-cli-server-test' }, null, 2));
  return root;
}

function waitForLine(child, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}`));
    }, timeoutMs);

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(pattern);
      if (match) {
        cleanup();
        resolve(match[0]);
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`CLI exited early with code ${code}`));
    };

    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    }

    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

test('server CLI commands start, status, config and stop work together', async () => {
  const root = await createProjectRoot();
  try {
    const child = spawn(process.execPath, [CLI, 'server', 'start', '--port', '0', '--no-open'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const startedLine = await waitForLine(child, /Сервер запущен: .+/u);
    assert.match(startedLine, /Сервер запущен:/u);
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    const status = spawnSync(process.execPath, [CLI, 'server', 'status'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(status.status, 0);
    assert.match(status.stdout, /Состояние сервера|Server status/u);

    const config = spawnSync(process.execPath, [CLI, 'server', 'config'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(config.status, 0);
    assert.match(config.stdout, /Порт:|Port:/u);

    const stop = spawnSync(process.execPath, [CLI, 'server', 'stop'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(stop.status, 0);
    assert.match(stop.stdout, /Сервер остановлен|Server stopped/u);

    const exitInfo = await exited;
    assert.ok(exitInfo.code === 0 || exitInfo.signal === 'SIGTERM' || exitInfo.signal === null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('server CLI status reports stopped state when no pid exists', async () => {
  const root = await createProjectRoot();
  try {
    const status = spawnSync(process.execPath, [CLI, 'server', 'status'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(status.status, 0);
    assert.match(status.stdout, /Сервер не запущен|Server is not running/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
