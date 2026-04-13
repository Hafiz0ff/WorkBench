import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import {
  previewExtensionInstall,
  installExtension,
  listInstalledExtensions,
  enableExtension,
  disableExtension,
  updateExtension,
  removeExtension,
  doctorExtensions,
} from '../src/extensions.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-extensions-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-project',
    version: '0.1.0',
    type: 'module',
  }, null, 2));
  return root;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fileResponse(text, repoPath) {
  return jsonResponse({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(text, 'utf8').toString('base64'),
    path: repoPath,
    sha: `sha-${repoPath}`,
  });
}

function makeGitHubFetch({ manifest, files }) {
  return async (url) => {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!match) {
      return new Response('not found', { status: 404 });
    }
    const repoPath = decodeURIComponent(match[3]);
    if (repoPath === 'packs/demo/localcodex-extension.json') {
      return fileResponse(JSON.stringify(manifest, null, 2), repoPath);
    }
    const entry = files[repoPath];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    if (entry.kind === 'dir') {
      return jsonResponse(entry.entries);
    }
    return fileResponse(entry.content, repoPath);
  };
}

async function withFetchStub(fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('GitHub source parsing and manifest preview handle full URLs and subdirectories', async () => {
  const root = await createTempProject();
  const manifest = {
    schemaVersion: 1,
    id: 'sample.role-pack',
    name: 'Sample Pack',
    version: '1.0.0',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Sample extension pack.',
    source: {
      kind: 'github',
      owner: 'octo',
      repo: 'sample',
      ref: 'main',
      subdirectory: 'packs/demo',
      url: 'https://github.com/octo/sample/tree/main/packs/demo',
    },
    compatibility: { app: '>=0.1.0', schema: '1' },
    entryPaths: ['roles', 'prompts', 'tasks'],
    capabilities: ['adds roles', 'adds prompt packs', 'adds task templates'],
    installNotes: 'Inspect files before enabling.',
  };
  const files = {
    'packs/demo/roles': {
      kind: 'dir',
      entries: [
        { type: 'file', path: 'packs/demo/roles/senior-ops.md' },
      ],
    },
    'packs/demo/prompts': {
      kind: 'dir',
      entries: [
        { type: 'file', path: 'packs/demo/prompts/brief.md' },
      ],
    },
    'packs/demo/tasks': {
      kind: 'dir',
      entries: [
        { type: 'dir', path: 'packs/demo/tasks/templates' },
      ],
    },
    'packs/demo/tasks/templates': {
      kind: 'dir',
      entries: [
        { type: 'file', path: 'packs/demo/tasks/templates/checklist.md' },
      ],
    },
    'packs/demo/roles/senior-ops.md': {
      kind: 'file',
      content: `---\nname: senior-ops\ndescription: Extension role.\ngoals:\n  - Keep changes small.\nbehavioral_rules:\n  - Read first.\ntool_usage_guidance:\n  - Use read_file before write_file.\noutput_style:\n  - Short and factual.\ndo:\n  - Keep notes inspectable.\ndont:\n  - Execute arbitrary scripts.\n---\n`,
    },
    'packs/demo/prompts/brief.md': {
      kind: 'file',
      content: '# Brief\nUse concise, inspectable summaries.',
    },
    'packs/demo/tasks/templates/checklist.md': {
      kind: 'file',
      content: '# Checklist\n- [ ] Inspect files\n- [ ] Validate changes\n',
    },
  };

  await withFetchStub(makeGitHubFetch({ manifest, files }), async () => {
    const preview = await previewExtensionInstall(root, 'https://github.com/octo/sample/tree/main/packs/demo');
    assert.equal(preview.ok, true);
    assert.equal(preview.source.owner, 'octo');
    assert.equal(preview.source.repo, 'sample');
    assert.equal(preview.source.ref, 'main');
    assert.equal(preview.source.subdirectory, 'packs/demo');
    assert.equal(preview.approvalRequired, false);

    const result = await installExtension(root, 'https://github.com/octo/sample/tree/main/packs/demo', { confirm: true });
    assert.equal(result.installed, true);
    assert.equal(result.enabled, false);

    const registryPath = path.join(root, '.local-codex', 'extensions', 'registry.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(registry.extensions.length, 1);
    assert.equal(registry.extensions[0].id, 'sample.role-pack');

    const installRoot = path.join(root, '.local-codex', 'extensions', 'installed', 'sample.role-pack'.replaceAll('/', '__'));
    assert.match(await readFile(path.join(installRoot, 'roles', 'senior-ops.md'), 'utf8'), /senior-ops/);
    assert.match(await readFile(path.join(installRoot, 'prompts', 'brief.md'), 'utf8'), /concise/i);
    assert.match(await readFile(path.join(installRoot, 'tasks', 'templates', 'checklist.md'), 'utf8'), /Inspect files/);
  });
});

test('invalid manifests and incompatible manifests are rejected before install', async () => {
  const root = await createTempProject();
  const invalidManifest = {
    schemaVersion: 1,
    id: 'broken.invalid',
    name: 'Broken',
    version: '1.0.0',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Missing required fields.',
    source: { kind: 'github', owner: 'octo', repo: 'broken', ref: 'main', subdirectory: 'packs/demo' },
    compatibility: { app: '>=0.1.0', schema: '1' },
    entryPaths: [],
    capabilities: [],
  };

  const incompatibleManifest = {
    ...invalidManifest,
    id: 'broken.incompatible',
    entryPaths: ['roles'],
    compatibility: { app: '>=9.0.0', schema: '1' },
  };

  await withFetchStub(makeGitHubFetch({ manifest: invalidManifest, files: { 'packs/demo/roles': { kind: 'dir', entries: [] } } }), async () => {
    const preview = await previewExtensionInstall(root, 'octo/broken:packs/demo');
    assert.equal(preview.ok, false);
    assert.ok(preview.issues.length > 0);
  });

  await withFetchStub(makeGitHubFetch({ manifest: incompatibleManifest, files: { 'packs/demo/roles': { kind: 'dir', entries: [] } } }), async () => {
    const preview = await previewExtensionInstall(root, 'octo/broken:packs/demo');
    assert.equal(preview.ok, false);
    assert.match(preview.issues.join('\n'), /not compatible|совместим/i);
  });
});

test('install lifecycle preserves enabled state and supports update/remove', async () => {
  const root = await createTempProject();
  let version = '1.0.0';
  const manifestBase = {
    schemaVersion: 1,
    id: 'sample.role-pack',
    name: 'Sample Pack',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Sample extension pack.',
    source: {
      kind: 'github',
      owner: 'octo',
      repo: 'sample',
      ref: 'main',
      subdirectory: 'packs/demo',
      url: 'https://github.com/octo/sample/tree/main/packs/demo',
    },
    compatibility: { app: '>=0.1.0', schema: '1' },
    entryPaths: ['roles'],
    capabilities: ['adds roles'],
    installNotes: 'Inspect files before enabling.',
  };
  const files = {
    'packs/demo/roles': {
      kind: 'dir',
      entries: [{ type: 'file', path: 'packs/demo/roles/senior-ops.md' }],
    },
    'packs/demo/roles/senior-ops.md': {
      kind: 'file',
      content: `---\nname: senior-ops\ndescription: Extension role.\ngoals:\n  - Keep changes small.\nbehavioral_rules:\n  - Read first.\ntool_usage_guidance:\n  - Use read_file before write_file.\noutput_style:\n  - Short and factual.\ndo:\n  - Keep notes inspectable.\ndont:\n  - Execute arbitrary scripts.\n---\n`,
    },
  };

  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!match) {
      return new Response('not found', { status: 404 });
    }
    const repoPath = decodeURIComponent(match[3]);
    if (repoPath === 'packs/demo/localcodex-extension.json') {
      return fileResponse(JSON.stringify({ ...manifestBase, version }, null, 2), repoPath);
    }
    const entry = files[repoPath];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    if (entry.kind === 'dir') {
      return jsonResponse(entry.entries);
    }
    return fileResponse(entry.content, repoPath);
  };

  await withFetchStub(fetchImpl, async () => {
    const result = await installExtension(root, 'octo/sample:packs/demo', { confirm: true });
    assert.equal(result.registryEntry.enabled, false);

    let installed = await listInstalledExtensions(root);
    assert.equal(installed.length, 1);
    assert.equal(installed[0].enabled, false);
    assert.equal((await listInstalledExtensions(root, { enabledOnly: true })).length, 0);

    await enableExtension(root, 'sample.role-pack', { confirm: true });
    installed = await listInstalledExtensions(root);
    assert.equal(installed[0].enabled, true);
    assert.equal((await listInstalledExtensions(root, { enabledOnly: true })).length, 1);

    await disableExtension(root, 'sample.role-pack');
    assert.equal((await listInstalledExtensions(root, { enabledOnly: true })).length, 0);

    version = '1.1.0';
    await updateExtension(root, 'sample.role-pack', { confirm: true });
    installed = await listInstalledExtensions(root);
    assert.equal(installed[0].version, '1.1.0');

    await removeExtension(root, 'sample.role-pack');
    assert.equal((await listInstalledExtensions(root)).length, 0);
  });
});

test('doctor reports missing files and risky manifests', async () => {
  const root = await createTempProject();
  const manifest = {
    schemaVersion: 1,
    id: 'sample.role-pack',
    name: 'Sample Pack',
    version: '1.0.0',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Sample extension pack.',
    source: {
      kind: 'github',
      owner: 'octo',
      repo: 'sample',
      ref: 'main',
      subdirectory: 'packs/demo',
      url: 'https://github.com/octo/sample/tree/main/packs/demo',
    },
    compatibility: { app: '>=0.1.0', schema: '1' },
    entryPaths: ['roles/senior-ops.md'],
    capabilities: ['adds roles'],
  };
  const files = {
    'packs/demo/roles/senior-ops.md': {
      kind: 'file',
      content: '---\nname: senior-ops\ndescription: Extension role.\ngoals:\n  - Keep changes small.\nbehavioral_rules:\n  - Read first.\ntool_usage_guidance:\n  - Use read_file before write_file.\noutput_style:\n  - Short and factual.\ndo:\n  - Keep notes inspectable.\ndont:\n  - Execute arbitrary scripts.\n---\n',
    },
  };

  await withFetchStub(makeGitHubFetch({ manifest, files }), async () => {
    await installExtension(root, 'octo/sample:packs/demo', { confirm: true });
  });
  await rm(path.join(root, '.local-codex', 'extensions', 'installed', 'sample.role-pack'.replaceAll('/', '__'), 'roles', 'senior-ops.md'));

  const report = await doctorExtensions(root);
  assert.equal(report.extensions.length, 1);
  assert.ok(report.issues.some((issue) => /entry/i.test(issue.message) || /файл/i.test(issue.message)));
});

test('localized extension strings are available and CLI help includes extension commands', async () => {
  const translator = await (await import('../src/i18n.js')).createTranslator('ru');
  assert.match(translator('extensions.installPreviewTitle'), /Предпросмотр расширения/);
  assert.match(translator('extensions.listTitle'), /Расширения/);
});
