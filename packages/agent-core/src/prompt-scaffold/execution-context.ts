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
    '<environment_context>',
    `  <cwd>${context.cwd}</cwd>`,
    `  <shell>${context.shell}</shell>`,
    `  <os>${process.platform}</os>`,
    `  <timezone>${timezone}</timezone>`,
    `  <timestamp>${context.now.toISOString()}</timestamp>`,
    '</environment_context>',
  ];

  return ok(createUserMessage(lines.join('\n')));
}
