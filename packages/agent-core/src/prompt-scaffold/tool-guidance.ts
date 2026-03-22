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
    '<tool_guidance>',
    ...context.toolDefinitions.map((tool) => `- ${tool.name}: ${tool.description}`),
    '</tool_guidance>',
  ];

  return ok(createDeveloperMessage(lines.join('\n')));
}
