import { ok, type Result } from '@alt-stack/result';

import { createDeveloperMessage } from '../conversation-state.ts';
import type { ResponseMessageItem } from '../types.ts';
import type { PromptSectionContext } from './types.ts';

export function createToolGuidancePrompt(
  context: PromptSectionContext,
): Result<ResponseMessageItem | null, never> {
  if (context.toolDefinitions.length === 0) {
    return ok(null);
  }

  const lines = [
    '# Tool Guidance',
    ...context.toolDefinitions.map((tool) => `- ${tool.name}: ${tool.description}`),
  ];

  return ok(createDeveloperMessage(lines.join('\n')));
}
