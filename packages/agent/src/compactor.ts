import { createAssistantMessage, createUserMessage } from './conversation-state.ts';
import type { ModelClient, ResponseInputItem } from './types.ts';

const CONTINUATION_PROMPT =
  'Continue the current task using the summary above. Preserve all constraints and avoid redoing completed work unless needed.';

const COMPACTION_PROMPT = [
  'Summarize this agent conversation for continuation in a new compact context.',
  'Return a concise but complete summary using exactly these sections:',
  'Active Goal',
  'Constraints',
  'Relevant Files',
  'Key Findings',
  'Remaining Work',
  'User Preferences',
  'Do not ask follow-up questions. Do not include markdown fences.',
].join('\n');

export interface CompactConversationOptions {
  client: ModelClient;
  conversationItems: ResponseInputItem[];
  instructions: string;
  model: string;
  scaffoldItems: ResponseInputItem[];
}

export interface CompactionResult {
  replacementItems: ResponseInputItem[];
  summary: string;
}

export async function compactConversation(
  options: CompactConversationOptions,
): Promise<CompactionResult> {
  const iterator = options.client.streamTurn({
    input: [...options.scaffoldItems, ...options.conversationItems],
    instructions: `${options.instructions}\n\n${COMPACTION_PROMPT}`,
    model: options.model,
    tools: [],
  });

  while (true) {
    const next = await iterator.next();

    if (!next.done) {
      continue;
    }

    const summary = next.value.assistantText.trim();

    if (!summary) {
      throw new Error('Compaction did not produce a summary');
    }

    return {
      replacementItems: [createAssistantMessage(summary), createUserMessage(CONTINUATION_PROMPT)],
      summary,
    };
  }
}
