import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import {
  addRegistrySource,
  removeRegistrySource,
  refreshRegistryCatalog,
  installRegistryEntry,
  doctorRegistryCatalog,
  getRegistryCatalog,
  getRegistryEntry,
} from '../src/registry.js';

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-codex-registry-'));
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

test('registry source add/remove/refresh and install flow are file-based and inspectable', async () => {
  const root = await createTempProject();
  const curatedRegistryPath = path.join(root, 'extensions-registry.json');
  const manifest = {
    schemaVersion: 1,
    id: 'sample.reviewed',
    name: 'Sample Reviewed',
    version: '1.0.0',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Reviewed sample.',
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
  };
  const files = {
    'packs/demo/roles': {
      kind: 'dir',
      entries: [{ type: 'file', path: 'packs/demo/roles/senior-ops.md' }],
    },
    'packs/demo/roles/senior-ops.md': {
      kind: 'file',
      content: `---\nname: senior-ops\ndescription: Reviewed role.\ngoals:\n  - Keep changes small.\nbehavioral_rules:\n  - Read first.\ntool_usage_guidance:\n  - Use read_file before write_file.\noutput_style:\n  - Short and factual.\ndo:\n  - Keep notes inspectable.\ndont:\n  - Execute arbitrary scripts.\n---\n`,
    },
  };
  await writeFile(curatedRegistryPath, JSON.stringify({
    schemaVersion: 1,
    name: 'Workbench Curated Registry',
    publisher: 'Workbench',
    reviewStatus: 'reviewed',
    verifiedSource: true,
    trustLevel: 'reviewed',
    supportedAppVersions: ['>=0.1.0'],
    entries: [
      {
        id: 'sample.reviewed',
        name: 'Sample Reviewed',
        version: '1.0.0',
        type: 'role-pack',
        author: 'Codex Team',
        description: 'Reviewed sample.',
        source: {
          kind: 'github',
          owner: 'octo',
          repo: 'sample',
          ref: 'main',
          subdirectory: 'packs/demo',
          url: 'https://github.com/octo/sample/tree/main/packs/demo',
        },
        manifestPath: 'localcodex-extension.json',
        capabilities: ['adds roles'],
        compatibility: { app: '>=0.1.0', schema: '1' },
        publisher: 'Codex Team',
        reviewStatus: 'reviewed',
        verifiedSource: true,
        supportedAppVersions: ['>=0.1.0'],
        trustLevel: 'reviewed',
        recommended: true,
        installNotes: 'Install after inspection.',
      },
    ],
  }, null, 2));

  await withFetchStub(makeGitHubFetch({ manifest, files }), async () => {
    const added = await addRegistrySource(root, curatedRegistryPath);
    assert.equal(added.added, true);

    const catalog = await refreshRegistryCatalog(root);
    assert.equal(catalog.sources.length, 1);
    assert.equal(catalog.entries.length, 1);
    assert.equal(catalog.entries[0].reviewStatus, 'reviewed');
    assert.equal(catalog.entries[0].verifiedSource, true);

    const snapshot = await getRegistryCatalog(root);
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.sources.length, 1);

    const installResult = await installRegistryEntry(root, 'sample.reviewed');
    assert.equal(installResult.registryEntry.installSourceType, 'registry');
    assert.equal(installResult.registryEntry.registrySourceId.startsWith('source-'), true);

    const registryPath = path.join(root, '.local-codex', 'extensions', 'registry.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(registry.extensions.length, 1);
    assert.equal(registry.extensions[0].installSourceType, 'registry');
    assert.equal(registry.extensions[0].reviewStatus, 'reviewed');
    assert.equal(registry.extensions[0].verifiedSource, true);
    assert.deepEqual(registry.extensions[0].supportedAppVersions, ['>=0.1.0']);
    assert.equal((await getRegistryEntry(root, 'sample.reviewed')).id, 'sample.reviewed');

    const removed = await removeRegistrySource(root, curatedRegistryPath);
    assert.equal(removed.removed, true);
  });
});

test('registry doctor reports compatibility mismatches and stale or disabled sources', async () => {
  const root = await createTempProject();
  const curatedRegistryPath = path.join(root, 'extensions-registry.json');
  await writeFile(curatedRegistryPath, JSON.stringify({
    schemaVersion: 1,
    name: 'Workbench Curated Registry',
    publisher: 'Workbench',
    reviewStatus: 'reviewed',
    verifiedSource: true,
    trustLevel: 'reviewed',
    supportedAppVersions: ['>=9.0.0'],
    entries: [
      {
        id: 'sample.mismatch',
        name: 'Sample Mismatch',
        version: '1.0.0',
        type: 'role-pack',
        author: 'Codex Team',
        description: 'Mismatch sample.',
        source: {
          kind: 'github',
          owner: 'octo',
          repo: 'sample',
          ref: 'main',
          subdirectory: 'packs/demo',
          url: 'https://github.com/octo/sample/tree/main/packs/demo',
        },
        manifestPath: 'localcodex-extension.json',
        capabilities: ['adds roles'],
        compatibility: { app: '>=9.0.0', schema: '1' },
        publisher: 'Codex Team',
        reviewStatus: 'reviewed',
        verifiedSource: true,
        supportedAppVersions: ['>=9.0.0'],
        trustLevel: 'reviewed',
        recommended: false,
        installNotes: 'Install after inspection.',
      },
    ],
  }, null, 2));

  const manifest = {
    schemaVersion: 1,
    id: 'sample.mismatch',
    name: 'Sample Mismatch',
    version: '1.0.0',
    type: 'role-pack',
    author: 'Codex Team',
    description: 'Mismatch sample.',
    source: {
      kind: 'github',
      owner: 'octo',
      repo: 'sample',
      ref: 'main',
      subdirectory: 'packs/demo',
      url: 'https://github.com/octo/sample/tree/main/packs/demo',
    },
    compatibility: { app: '>=9.0.0', schema: '1' },
    entryPaths: ['roles'],
    capabilities: ['adds roles'],
  };
  const files = {
    'packs/demo/roles': {
      kind: 'dir',
      entries: [{ type: 'file', path: 'packs/demo/roles/senior-ops.md' }],
    },
    'packs/demo/roles/senior-ops.md': {
      kind: 'file',
      content: `---\nname: senior-ops\ndescription: Reviewed role.\ngoals:\n  - Keep changes small.\nbehavioral_rules:\n  - Read first.\ntool_usage_guidance:\n  - Use read_file before write_file.\noutput_style:\n  - Short and factual.\ndo:\n  - Keep notes inspectable.\ndont:\n  - Execute arbitrary scripts.\n---\n`,
    },
  };

  await withFetchStub(makeGitHubFetch({ manifest, files }), async () => {
    await addRegistrySource(root, curatedRegistryPath);
    await refreshRegistryCatalog(root);
  });

  const report = await doctorRegistryCatalog(root);
  assert.equal(report.sources.length, 1);
  assert.equal(report.catalog.length, 1);
  assert.ok(report.issues.some((issue) => /unsupported|не входит|устарела|mismatch|совместим/i.test(issue.message)));
});

test('registry localization strings are available for the new UX', async () => {
  const translator = await (await import('../src/i18n.js')).createTranslator('ru');
  assert.match(translator('registry.installPreviewTitle'), /Предпросмотр/);
  assert.match(translator('extensions.rawGitHubWarning'), /GitHub-источник/);
  assert.match(translator('registry.statusSummary', { total: 1, trusted: 1 }), /Registry/);
});
