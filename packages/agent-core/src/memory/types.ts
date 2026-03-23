import { Result, TaggedError } from '@alt-stack/result';
import z from 'zod';

export class StorageNotFound extends TaggedError<'StorageNotFound'> {
  readonly _tag = 'StorageNotFound';

  constructor() {
    super('Memory storage is not initialized or the backing database was removed.');
  }
}
export class SerializationError extends TaggedError<'SerializationError'> {
  readonly _tag = 'SerializationError';

  constructor(public readonly value: unknown) {
    super('Memory item could not be serialized for storage.');
  }
}

export const MemoryItemIdSchema = z.string().brand<'MemoryItemId'>();
export const MemoryItemTagSchema = z.string().brand<'MemoryItemTag'>();
export const MemoryItemTextSchema = z.string().brand<'MemoryItemText'>();

export const MemoryItemSchema = z.strictObject({
  id: MemoryItemIdSchema,
  tags: z.array(MemoryItemTagSchema),
  text: MemoryItemTextSchema,
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export interface MemoryStorage<TInitializeOptions = {}> {
  initialize: (
    options?: { overwrite?: boolean } & TInitializeOptions,
  ) => Promise<Result<void, never>>;
  add: (item: MemoryItem) => Result<void, StorageNotFound | SerializationError>;
  remove: (id: string) => Result<MemoryItem | null, StorageNotFound>;
  delete: () => Result<boolean, never>;
  search: (query: string) => Result<MemoryItem[], StorageNotFound>;
}
