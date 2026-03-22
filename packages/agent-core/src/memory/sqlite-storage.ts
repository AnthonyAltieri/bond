import { Database } from 'bun:sqlite';

import { ensureParentDir } from '@bond/utils';

import type { MemoryStorage } from './types';

export const DEFAULT_DB_PATH = '~/.bond/memory/memory.db';

export const SqliteMemoryStorage: MemoryStorage = {
  async initialize(options?: { overwrite?: boolean; dbPath?: string }) {
    const path = options?.dbPath ?? DEFAULT_DB_PATH;
    await ensureParentDir(path);

    new Database(path);
  },
};
