import { isErr, ok, type Result } from '@alt-stack/result';

import { createAgentIdentityPrompt } from './agent-identity.ts';
import { createAgentMemoryPrompt } from './agent-memory.ts';
import { createAgentsMdPrompt } from './agents-md.ts';
import { createConversationHistoryPrompt } from './conversation-history.ts';
import { createExecutionContextPrompt } from './execution-context.ts';
import type { PromptScaffoldError } from './errors.ts';
import { createSkillsPrompt } from './skills.ts';
import { createToolGuidancePrompt } from './tool-guidance.ts';
import type {
  PromptSectionContext,
  PromptSectionItems,
  PromptSectionResult,
  PromptUserMessage,
} from './types.ts';
import { createUserInputPrompt } from './user-input.ts';
import type { ResponseInputItem } from '../types.ts';

export const DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS = 32 * 1024;

export function buildPrompt(
  context: PromptSectionContext,
  nextUserMessage?: PromptUserMessage,
): Result<ResponseInputItem[], PromptScaffoldError> {
  const items: ResponseInputItem[] = [];
  const sections: PromptSectionResult[] = [
    createAgentIdentityPrompt(),
    createToolGuidancePrompt(context),
    createAgentMemoryPrompt(),
    createSkillsPrompt(),
    createAgentsMdPrompt(context),
    createExecutionContextPrompt(context),
    createConversationHistoryPrompt(context),
    createUserInputPrompt(nextUserMessage),
  ];

  for (const section of sections) {
    if (isErr(section)) {
      return section;
    }

    appendPromptSection(items, section.value);
  }

  return ok(items);
}

function appendPromptSection(items: ResponseInputItem[], section: PromptSectionItems): void {
  if (!section) {
    return;
  }

  if (Array.isArray(section)) {
    items.push(...section);
    return;
  }

  items.push(section);
}
