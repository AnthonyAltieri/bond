import { existsSync, rmSync } from 'node:fs';

import { Database } from 'bun:sqlite';
import { err, ok } from '@alt-stack/result';

import { ensureParentDir } from '@bond/utils';

import {
  MemoryItemSchema,
  SerializationError,
  StorageNotFound,
  type MemoryItem,
  type MemoryStorage,
} from './types.ts';

export const DEFAULT_DB_PATH = '~/.bond/memory/memory.db';

const MEMORY_ITEMS_TABLE = 'memory_items';
const STORAGE_NOT_FOUND_TAG = { _tag: 'StorageNotFound' } as const;
const SERIALIZATION_ERROR_TAG = { _tag: 'SerializationError' } as const;

type MemoryRow = { id: string; tags_json: string; text: string };

let activeDbPath: string | null = null;

function isError<TError extends { readonly _tag: string }>(
  value: unknown,
  taggedError: TError,
): value is TError {
  return (
    value instanceof Error &&
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    value._tag === taggedError._tag
  );
}

function deleteDbFiles(dbPath: string): boolean {
  const existed = existsSync(dbPath) || existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  return existed;
}

function migration(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MEMORY_ITEMS_TABLE} (
      id TEXT PRIMARY KEY,
      tags_json TEXT NOT NULL,
      text TEXT NOT NULL
    )
  `);
}

function openExistingDatabase(): Database | StorageNotFound {
  if (!activeDbPath || !existsSync(activeDbPath)) {
    return new StorageNotFound();
  }

  try {
    const db = new Database(activeDbPath, { create: false, strict: true });
    migration(db);
    return db;
  } catch {
    return new StorageNotFound();
  }
}

function serializeItem(item: MemoryItem): string | SerializationError {
  const parsed = MemoryItemSchema.safeParse(item);
  if (!parsed.success) {
    return new SerializationError(item);
  }

  try {
    return JSON.stringify(parsed.data.tags);
  } catch {
    return new SerializationError(item);
  }
}

function deserializeRow(row: MemoryRow): MemoryItem {
  const tags = JSON.parse(row.tags_json);
  return MemoryItemSchema.parse({ id: row.id, tags, text: row.text });
}

function toLikePattern(query: string): string {
  const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

export const SqliteMemoryStorage: MemoryStorage<{ dbPath?: string }> = {
  async initialize(options?: { overwrite?: boolean; dbPath?: string }) {
    const requestedPath = options?.dbPath ?? DEFAULT_DB_PATH;
    const path = await ensureParentDir(requestedPath);

    if (options?.overwrite) {
      deleteDbFiles(path);
    }

    const db = new Database(path, { strict: true });
    migration(db);
    db.close();

    activeDbPath = path;

    return ok();
  },

  add(item) {
    const db = openExistingDatabase();
    if (isError(db, STORAGE_NOT_FOUND_TAG)) {
      return err(db);
    }

    const tagsJson = serializeItem(item);
    if (isError(tagsJson, SERIALIZATION_ERROR_TAG)) {
      db.close();
      return err(tagsJson);
    }

    try {
      db.query<[never], [string, string, string]>(
        `
            INSERT INTO ${MEMORY_ITEMS_TABLE} (id, tags_json, text)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              tags_json = excluded.tags_json,
              text = excluded.text
          `,
      ).run(item.id, tagsJson, item.text);

      return ok();
    } finally {
      db.close();
    }
  },

  remove(id) {
    const db = openExistingDatabase();
    if (isError(db, STORAGE_NOT_FOUND_TAG)) {
      return err(db);
    }

    try {
      const row = db
        .query<MemoryRow | null, [string]>(
          `SELECT id, tags_json, text FROM ${MEMORY_ITEMS_TABLE} WHERE id = ?`,
        )
        .get(id);

      if (!row) {
        return ok(null);
      }

      const item = deserializeRow(row);
      db.query<[never], [string]>(`DELETE FROM ${MEMORY_ITEMS_TABLE} WHERE id = ?`).run(id);
      return ok(item);
    } finally {
      db.close();
    }
  },

  delete() {
    if (!activeDbPath) {
      return ok(false);
    }

    return ok(deleteDbFiles(activeDbPath));
  },

  search(query) {
    const db = openExistingDatabase();
    if (isError(db, STORAGE_NOT_FOUND_TAG)) {
      return err(db);
    }

    try {
      const normalizedQuery = query.trim();
      const rows =
        normalizedQuery.length === 0
          ? db
              .query<MemoryRow, []>(
                `SELECT id, tags_json, text FROM ${MEMORY_ITEMS_TABLE} ORDER BY rowid`,
              )
              .all()
          : db
              .query<MemoryRow, [string, string]>(
                `
                  SELECT id, tags_json, text
                  FROM ${MEMORY_ITEMS_TABLE}
                  WHERE text LIKE ? ESCAPE '\\'
                     OR tags_json LIKE ? ESCAPE '\\'
                  ORDER BY rowid
                `,
              )
              .all(toLikePattern(normalizedQuery), toLikePattern(normalizedQuery));

      return ok(rows.map(deserializeRow));
    } finally {
      db.close();
    }
  },
};
