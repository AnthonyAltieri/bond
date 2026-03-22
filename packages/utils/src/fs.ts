import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { access, mkdir } from 'node:fs/promises';

export async function ensureParentDir(filePath: string) {
  const expanded = filePath.startsWith('~/') ? filePath.replace('~', homedir()) : filePath;

  await mkdir(dirname(expanded), { recursive: true });
  return expanded;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
