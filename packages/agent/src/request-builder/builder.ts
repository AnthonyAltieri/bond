import { isErr, ok, type Result } from '@alt-stack/result';

import { createAgentIdentityPrompt } from './agent-identity.ts';
import { createAgentMemoryPrompt } from './agent-memory.ts';
import { createAgentsMdPrompt } from './agents-md.ts';
import { createConversationHistoryPrompt } from './conversation-history.ts';
import { createExecutionContextPrompt } from './execution-context.ts';
import type { PromptScaffoldError } from './errors.ts';
import { createSkillsPrompt } from './skills.ts';
import { createToolGuidancePrompt } from './tool-guidance.ts';
import type { PromptSectionContext, PromptSectionResult, PromptUserMessage } from './types.ts';
import { createUserInputPrompt } from './user-input.ts';
import type { ResponseInputItem } from '../types.ts';

export const DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS = 32 * 1024;

export function buildRequest(
  context: PromptSectionContext,
  nextUserMessage?: PromptUserMessage,
): Result<ResponseInputItem[], PromptScaffoldError> {
  const sections: PromptSectionResult[] = [
    createAgentIdentityPrompt(),
    createToolGuidancePrompt(context),
    createAgentMemoryPrompt(),
    createAgentsMdPrompt(context),
    createExecutionContextPrompt(context),
    createConversationHistoryPrompt(context),
    createSkillsPrompt(),
    createUserInputPrompt(nextUserMessage),
  ];

  const items: ResponseInputItem[] = [];
  for (const section of sections) {
    // short circuit on any issue
    if (isErr(section)) return section;

    if (!section.value) {
      continue;
    } else if (Array.isArray(section.value)) {
      items.push(...section.value);
    } else {
      items.push(section.value);
    }
  }

  return ok(items);
}

export const buildPrompt = buildRequest;
