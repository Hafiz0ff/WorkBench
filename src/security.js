import path from 'node:path';

export function normalizeRoot(rootPath) {
  return path.resolve(rootPath);
}

export function resolveWithinRoot(rootPath, targetPath) {
  const root = normalizeRoot(rootPath);
  const resolved = path.resolve(root, targetPath);
  const relative = path.relative(root, resolved);
  const escaped = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escaped) {
    throw new Error(`Path escapes project root: ${targetPath}`);
  }
  return resolved;
}

export function isWithinRoot(rootPath, targetPath) {
  try {
    resolveWithinRoot(rootPath, targetPath);
    return true;
  } catch {
    return false;
  }
}
