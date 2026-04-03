import { err, ok, type Result } from '@alt-stack/result';

import type { ResponseMessageItem } from '../types.ts';
import { PromptScaffoldInvalidUserInputError } from './errors.ts';
import type { PromptUserMessage } from './types.ts';

export function createUserInputPrompt(
  nextUserMessage?: PromptUserMessage,
): Result<ResponseMessageItem | null, PromptScaffoldInvalidUserInputError> {
  if (!nextUserMessage) {
    return ok(null);
  }

  if (nextUserMessage.content.some((part) => part.type !== 'input_text')) {
    return err(new PromptScaffoldInvalidUserInputError());
  }

  return ok(structuredClone(nextUserMessage));
}
