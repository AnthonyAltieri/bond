import { err, ok, type Result } from '@alt-stack/result';

import { createUserMessage } from '../conversation-state.ts';
import type { ResponseMessageItem } from '../types.ts';
import { PromptScaffoldInvalidExecutionContextError } from './errors.ts';
import type { PromptSectionContext } from './types.ts';

export function createExecutionContextPrompt(
  context: PromptSectionContext,
): Result<ResponseMessageItem, PromptScaffoldInvalidExecutionContextError> {
  if (Number.isNaN(context.now.getTime())) {
    return err(new PromptScaffoldInvalidExecutionContextError(String(context.now)));
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const lines = [
    '# Execution Environment Context',
    `  - cwd: ${context.cwd}`,
    `  - shell: ${context.shell}`,
    `  - os: ${process.platform}`,
    `  - timezone: ${timezone}`,
    `  - current timestamp: ${context.now.toISOString()}`,
  ];

  return ok(createUserMessage(lines.join('\n')));
}
