import type { Result } from '@alt-stack/result';

import type { PromptScaffoldError } from './errors.ts';
import type { ResponseInputItem, ResponseMessageItem, ToolDefinition } from '../types.ts';

export interface PromptSectionContext {
  cwd: string;
  history: ResponseInputItem[];
  maxRepoInstructionsChars: number;
  now: Date;
  shell: string;
  toolDefinitions: ToolDefinition[];
}

export type PromptUserMessage = ResponseMessageItem & { role: 'user' };

export type PromptSectionItems = ResponseInputItem | ResponseInputItem[] | null;

export type PromptSectionResult<E extends PromptScaffoldError = PromptScaffoldError> = Result<
  PromptSectionItems,
  E
>;
