import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Volumes/Inside 1/ЛОКАЛКА';

test('release hardening scripts and docs exist with expected validation steps', async () => {
  const scripts = [
    'scripts/sign_macos_app.sh',
    'scripts/notarize_macos_app.sh',
    'scripts/staple_macos_app.sh',
    'scripts/validate_notarized_app.sh',
  ];
  for (const script of scripts) {
    const content = await readFile(path.join(root, script), 'utf8');
    assert.match(content, /xcrun|codesign|notarytool|stapler|spctl/);
  }

  const checklist = await readFile(path.join(root, 'docs/release-checklist.md'), 'utf8');
  assert.match(checklist, /notarization|Gatekeeper|extension registry|README/i);

  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /Unreleased|0\.1\.0/);

  const releaseNotesTemplate = await readFile(path.join(root, 'docs/release-notes-template.md'), 'utf8');
  assert.match(releaseNotesTemplate, /Version \{version\}|Extensions \/ Registry/i);
});
