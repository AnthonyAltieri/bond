import { ok, type Result } from '@alt-stack/result';

import type { ResponseInputItem } from '../types.ts';
import type { PromptSectionContext } from './types.ts';

export function createConversationHistoryPrompt(
  context: PromptSectionContext,
): Result<ResponseInputItem[] | null, never> {
  if (context.history.length === 0) {
    return ok(null);
  }

  return ok(structuredClone(context.history));
}
