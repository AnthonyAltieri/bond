import { ok, type Result } from '@alt-stack/result';

import { createDeveloperMessage } from '../conversation-state.ts';
import type { ResponseMessageItem } from '../types.ts';

const DEFAULT_PERMISSIONS_INSTRUCTIONS = [
  '<permissions instructions>',
  '- You are running inside a local CLI agent harness.',
  '- You may use the shell tool to inspect files, edit code, create projects, and install dependencies inside the workspace.',
  '- Prefer direct, minimal commands that help complete the current task, then verify the result with targeted checks.',
  '- Respect repo instructions and avoid unnecessary tool calls.',
  '</permissions instructions>',
].join('\n');

export function createAgentIdentityPrompt(): Result<ResponseMessageItem, never> {
  return ok(createDeveloperMessage(DEFAULT_PERMISSIONS_INSTRUCTIONS));
}
