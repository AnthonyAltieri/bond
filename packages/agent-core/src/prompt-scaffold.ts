import type { Result } from '@alt-stack/result';

import { buildPrompt, DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS } from './prompt-scaffold/builder.ts';
import type { PromptScaffoldError } from './prompt-scaffold/errors.ts';
import type { PromptSectionContext } from './prompt-scaffold/types.ts';
import type { ResponseInputItem, ToolDefinition } from './types.ts';

export interface PromptScaffoldOptions {
  cwd: string;
  maxRepoInstructionsChars?: number;
  shell: string;
  toolDefinitions?: ToolDefinition[];
}

export function buildPromptScaffold(
  options: PromptScaffoldOptions,
): Result<ResponseInputItem[], PromptScaffoldError> {
  const context: PromptSectionContext = {
    cwd: options.cwd,
    history: [],
    maxRepoInstructionsChars:
      options.maxRepoInstructionsChars ?? DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS,
    now: new Date(),
    shell: options.shell,
    toolDefinitions: options.toolDefinitions ?? [],
  };

  return buildPrompt(context);
}
