import type {
  ResponseFunctionCallOutputItem,
  ResponseInputItem,
  ResponseMessageItem,
} from './types.ts';

export class ConversationState {
  private conversationItems: ResponseInputItem[] = [];

  constructor(private readonly scaffoldItems: ResponseInputItem[]) {}

  appendResponseItems(items: ResponseInputItem[]): void {
    this.conversationItems.push(...items);
  }

  appendToolOutput(callId: string, output: string): void {
    const item: ResponseFunctionCallOutputItem = {
      call_id: callId,
      output,
      type: 'function_call_output',
    };
    this.conversationItems.push(item);
  }

  appendUserMessage(text: string): void {
    this.conversationItems.push(createUserMessage(text));
  }

  canCompact(): boolean {
    return this.conversationItems.length > 2;
  }

  getConversationItems(): ResponseInputItem[] {
    return structuredClone(this.conversationItems);
  }

  getInputItems(): ResponseInputItem[] {
    return [...structuredClone(this.scaffoldItems), ...structuredClone(this.conversationItems)];
  }

  replaceConversation(items: ResponseInputItem[]): void {
    this.conversationItems = structuredClone(items);
  }
}

export function createAssistantMessage(text: string): ResponseMessageItem {
  return { content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' };
}

export function createDeveloperMessage(text: string): ResponseMessageItem {
  return { content: [{ text, type: 'input_text' }], role: 'developer', type: 'message' };
}

export function createUserMessage(text: string): ResponseMessageItem {
  return { content: [{ text, type: 'input_text' }], role: 'user', type: 'message' };
}
