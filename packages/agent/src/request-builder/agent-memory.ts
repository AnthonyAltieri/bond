import { ok, type Result } from '@alt-stack/result';

import type { ResponseInputItem } from '../types.ts';

export function createAgentMemoryPrompt(): Result<ResponseInputItem | null, never> {
  return ok(null);
}
