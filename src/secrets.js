import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const WORKBENCH_DIR_NAME = '.workbench';
const SECRETS_FILE_NAME = 'secrets.json';

function getWorkbenchHome() {
  return path.resolve(process.env.WORKBENCH_HOME || path.join(os.homedir(), WORKBENCH_DIR_NAME));
}

export function getSecretsPath() {
  return path.join(getWorkbenchHome(), SECRETS_FILE_NAME);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function readSecrets() {
  return readJsonFile(getSecretsPath(), {});
}

export async function writeSecrets(next) {
  await ensureDir(getWorkbenchHome());
  await fs.writeFile(getSecretsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function resolveSecretValue(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('@secret:')) {
    return ref;
  }
  const key = ref.slice('@secret:'.length).trim();
  if (!key) {
    return '';
  }
  const secrets = await readSecrets();
  return typeof secrets[key] === 'string' ? secrets[key] : '';
}

export async function setSecretValue(key, value) {
  const secrets = await readSecrets();
  secrets[key] = String(value ?? '');
  await writeSecrets(secrets);
  return secrets[key];
}

