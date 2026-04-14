import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTask } from '../src/tasks.js';
import { appendMessage, createMessageId, createSessionId } from '../src/conversation.js';
import { setProviderApiKey } from '../src/providers/index.js';
import { startServer, stopServer } from '../src/server.js';
import { setCurrentTask } from '../src/tasks.js';
import { trackEvent } from '../src/stats.js';

async function createProjectRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-server-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'workbench-server-test' }, null, 2));
  return root;
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

async function startTestServer(root) {
  const { url } = await startServer(root, { port: 0, host: '0.0.0.0', open: false });
  return { url };
}

test('server exposes project, tasks, providers and tests APIs', async (t) => {
  const root = await createProjectRoot();
  const previousHome = process.env.WORKBENCH_HOME;
  const workbenchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-server-home-'));
  process.env.WORKBENCH_HOME = workbenchHome;
  await setProviderApiKey(root, 'openai', 'sk-test-secret');
  const task = await createTask(root, {
    title: 'API dashboard task',
    userRequest: 'Build the dashboard',
    summary: 'Dashboard task',
    role: 'frontend-engineer',
    model: 'gpt-4o',
  });
  await setCurrentTask(root, task.id);
  const sessionId = createSessionId();
  await appendMessage(task.folderPath, {
    id: createMessageId(),
    role: 'user',
    content: 'Привет',
    timestamp: new Date().toISOString(),
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId,
  });
  await appendMessage(task.folderPath, {
    id: createMessageId(),
    role: 'assistant',
    content: 'Здравствуйте',
    timestamp: new Date().toISOString(),
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    sessionId,
  });
  await trackEvent(root, {
    type: 'provider.request',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 200,
    completionTokens: 50,
  });

  const { url } = await startTestServer(root);
  t.after(async () => {
    await stopServer(root).catch(() => {});
    await cleanup(root);
    process.env.WORKBENCH_HOME = previousHome;
    await fs.rm(workbenchHome, { recursive: true, force: true });
  });

  const status = await fetch(`${url}/api/v1/project/status`).then((response) => response.json());
  assert.equal(status.name, 'workbench-server-test');
  assert.equal(status.task.id, task.id);

  const tasks = await fetch(`${url}/api/v1/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].id, task.id);

  const history = await fetch(`${url}/api/v1/tasks/${encodeURIComponent(task.id)}/history?limit=5`).then((response) => response.json());
  assert.equal(history.messages.length, 2);

  const providers = await fetch(`${url}/api/v1/providers`).then((response) => response.json());
  const providerText = JSON.stringify(providers);
  assert.ok(providerText.includes('"name":"openai"'));
  assert.ok(!providerText.includes('sk-test-secret'));

  const workspaces = await fetch(`${url}/api/v1/workspaces`).then((response) => response.json());
  assert.ok(Array.isArray(workspaces.workspaces));
  assert.equal(workspaces.workspaces[0].path, root);

  const workspaceSwitch = await fetch(`${url}/api/v1/workspaces/${encodeURIComponent(workspaces.workspaces[0].id)}/switch`, {
    method: 'POST',
  }).then((response) => response.json());
  assert.equal(workspaceSwitch.ok, true);

  const workspaceRefresh = await fetch(`${url}/api/v1/workspaces/refresh`, {
    method: 'POST',
  }).then((response) => response.json());
  assert.ok(workspaceRefresh.count >= 1);

  const registry = await fetch(`${url}/api/v1/registry`).then((response) => response.json());
  assert.ok(Array.isArray(registry.entries));
  const registryDoctor = await fetch(`${url}/api/v1/registry/doctor`).then((response) => response.json());
  assert.ok(Array.isArray(registryDoctor.issues));

  const eventResponse = await fetch(`${url}/api/v1/events`);
  assert.equal(eventResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  const testRun = await fetch(`${url}/api/v1/tests/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'node -e "process.exit(0)"', taskId: task.id }),
  }).then((response) => response.json());
  assert.equal(testRun.run.status, 'passed');

  const testsHistory = await fetch(`${url}/api/v1/tests/history?limit=5`).then((response) => response.json());
  assert.ok(testsHistory.runs.length >= 1);

  const stats = await fetch(`${url}/api/v1/stats`).then((response) => response.json());
  assert.ok(stats.tasks.total >= 1);
  assert.equal(stats.providers.topProvider, 'openai');

  const statsEvents = await fetch(`${url}/api/v1/stats/events?limit=10`).then((response) => response.json());
  assert.ok(Array.isArray(statsEvents.events));
  assert.ok(statsEvents.events.length >= 1);

  const rootHtml = await fetch(`${url}/`).then((response) => response.text());
  assert.match(rootHtml, /Workbench Dashboard/);
  const appJs = await fetch(`${url}/app.js`).then((response) => response.text());
  assert.match(appJs, /renderMarkdown/);
  assert.doesNotThrow(() => new Function(appJs));
});
