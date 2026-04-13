import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot, resolveWithinRoot } from './security.js';
import { evaluatePathPolicy, readProjectPolicy } from './policy.js';
import { stageProjectFileChange, deleteProjectFile as stageDeleteProjectFile } from './patches.js';

const DEFAULT_IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', '.DS_Store']);

export async function openProject(projectPath) {
  const root = normalizeRoot(projectPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
  return { root };
}

export async function formatProjectTree(root, maxDepth = 3) {
  const rootName = '.';
  const lines = [rootName];
  const maxEntries = 2000;
  let seen = 0;

  async function walk(currentDir, prefix, depth) {
    if (depth > maxDepth || seen >= maxEntries) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const filtered = entries.filter((entry) => !DEFAULT_IGNORED_NAMES.has(entry.name));

    for (let index = 0; index < filtered.length; index += 1) {
      if (seen >= maxEntries) {
        lines.push(`${prefix}...`);
        return;
      }

      const entry = filtered[index];
      const last = index === filtered.length - 1;
      const branch = last ? '└── ' : '├── ';
      lines.push(`${prefix}${branch}${entry.name}`);
      seen += 1;

      if (entry.isDirectory() && depth < maxDepth) {
        const nextPrefix = `${prefix}${last ? '    ' : '│   '}`;
        await walk(path.join(currentDir, entry.name), nextPrefix, depth + 1);
      }
    }
  }

  await walk(root, '', 1);
  return lines.join('\n');
}

export async function listProjectFiles(root, depth = 3) {
  return formatProjectTree(root, depth);
}

export async function readProjectFile(root, relativePath, maxCharsOrOptions = 20000, maybeOptions = {}) {
  const options = typeof maxCharsOrOptions === 'object' && maxCharsOrOptions !== null
    ? maxCharsOrOptions
    : maybeOptions;
  const maxChars = typeof maxCharsOrOptions === 'number'
    ? maxCharsOrOptions
    : 20000;
  const absolutePath = resolveWithinRoot(root, relativePath);
  const policy = options.policy || await readProjectPolicy(root);
  const readDecision = evaluatePathPolicy(policy, path.relative(normalizeRoot(root), absolutePath), 'read', root);
  if (readDecision.blocked || readDecision.approvalRequired) {
    const error = new Error(readDecision.reason);
    error.code = readDecision.blocked ? 'POLICY_BLOCKED' : 'POLICY_APPROVAL_REQUIRED';
    throw error;
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  const content = await fs.readFile(absolutePath, 'utf8');
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...[truncated ${content.length - maxChars} characters]`;
}

export async function writeProjectFile(root, relativePath, content, options = {}) {
  return stageProjectFileChange(root, relativePath, String(content ?? ''), options);
}

export async function deleteProjectFile(root, relativePath, options = {}) {
  return stageDeleteProjectFile(root, relativePath, options);
}
