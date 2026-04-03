import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isErr, isOk } from '@alt-stack/result';

import { SqliteMemoryStorage } from '../src/memory/sqlite-storage.ts';
import { MemoryItemSchema, StorageNotFound } from '../src/memory/types.ts';

const tempDirs = new Set<string>();

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bond-agent-core-memory-'));
  tempDirs.add(dir);
  return join(dir, 'memory.db');
}

function createMemoryItem(id: string, text: string, tags: string[]) {
  return MemoryItemSchema.parse({ id, text, tags });
}

afterEach(() => {
  SqliteMemoryStorage.delete();

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }

  tempDirs.clear();
});

describe('SqliteMemoryStorage', () => {
  test('returns StorageNotFound when used before initialization', () => {
    const result = SqliteMemoryStorage.search('anything');

    expect(isErr(result)).toBe(true);
    expect(result.error).toBeInstanceOf(StorageNotFound);
  });

  test('initializes storage, persists items, and searches text and tags', async () => {
    const dbPath = createTempDbPath();
    const initializeResult = await SqliteMemoryStorage.initialize({ dbPath });

    expect(isOk(initializeResult)).toBe(true);
    expect(existsSync(dbPath)).toBe(true);

    const alpha = createMemoryItem('alpha', 'remember the deployment checklist', [
      'ops',
      'runbook',
    ]);
    const beta = createMemoryItem('beta', 'review the quarterly plan', ['planning']);

    const addAlphaResult = SqliteMemoryStorage.add(alpha);
    const addBetaResult = SqliteMemoryStorage.add(beta);

    expect(isOk(addAlphaResult)).toBe(true);
    expect(isOk(addBetaResult)).toBe(true);

    const textSearch = SqliteMemoryStorage.search('deployment');
    expect(isOk(textSearch)).toBe(true);
    expect(textSearch.value).toEqual([alpha]);

    const tagSearch = SqliteMemoryStorage.search('planning');
    expect(isOk(tagSearch)).toBe(true);
    expect(tagSearch.value).toEqual([beta]);
  });

  test('removes stored items and returns the removed record', async () => {
    const dbPath = createTempDbPath();
    await SqliteMemoryStorage.initialize({ dbPath });

    const item = createMemoryItem('alpha', 'cleanup temp files', ['maintenance']);
    SqliteMemoryStorage.add(item);

    const removeResult = SqliteMemoryStorage.remove(item.id);
    expect(isOk(removeResult)).toBe(true);
    expect(removeResult.value).toEqual(item);

    const secondRemoveResult = SqliteMemoryStorage.remove(item.id);
    expect(isOk(secondRemoveResult)).toBe(true);
    expect(secondRemoveResult.value).toBeNull();

    const searchResult = SqliteMemoryStorage.search('');
    expect(isOk(searchResult)).toBe(true);
    expect(searchResult.value).toEqual([]);
  });

  test('overwrites an existing database when requested', async () => {
    const dbPath = createTempDbPath();
    await SqliteMemoryStorage.initialize({ dbPath });
    SqliteMemoryStorage.add(createMemoryItem('alpha', 'stale value', ['old']));

    const overwriteResult = await SqliteMemoryStorage.initialize({ dbPath, overwrite: true });
    expect(isOk(overwriteResult)).toBe(true);

    const searchResult = SqliteMemoryStorage.search('');
    expect(isOk(searchResult)).toBe(true);
    expect(searchResult.value).toEqual([]);
  });

  test('deletes the database file and reports whether anything was removed', async () => {
    const dbPath = createTempDbPath();
    await SqliteMemoryStorage.initialize({ dbPath });
    SqliteMemoryStorage.add(createMemoryItem('alpha', 'to be deleted', ['cleanup']));

    const firstDelete = SqliteMemoryStorage.delete();
    expect(isOk(firstDelete)).toBe(true);
    expect(firstDelete.value).toBe(true);
    expect(existsSync(dbPath)).toBe(false);

    const secondDelete = SqliteMemoryStorage.delete();
    expect(isOk(secondDelete)).toBe(true);
    expect(secondDelete.value).toBe(false);

    const searchResult = SqliteMemoryStorage.search('deleted');
    expect(isErr(searchResult)).toBe(true);
    expect(searchResult.error).toBeInstanceOf(StorageNotFound);
  });
});
