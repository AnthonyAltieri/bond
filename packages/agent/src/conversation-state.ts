import type {
  ResponseCustomToolCallOutputItem,
  ResponseFunctionCallOutputItem,
  ResponseInputItem,
  ResponseMessageItem,
  ToolCall,
  ToolCallOutput,
} from './types.ts';

export class ConversationState {
  private conversationItems: ResponseInputItem[] = [];

  constructor(
    private readonly scaffoldItems: ResponseInputItem[],
    initialConversationItems: ResponseInputItem[] = [],
  ) {
    this.conversationItems = structuredClone(initialConversationItems);
  }

  appendResponseItems(items: ResponseInputItem[]): void {
    this.conversationItems.push(...items);
  }

  appendToolOutput(call: ToolCall, output: ToolCallOutput): void {
    if (call.kind === 'custom') {
      const item: ResponseCustomToolCallOutputItem = {
        call_id: call.id,
        output: cloneToolCallOutput(output),
        type: 'custom_tool_call_output',
      };
      this.conversationItems.push(item);
      return;
    }

    const item: ResponseFunctionCallOutputItem = {
      call_id: call.id,
      output: cloneToolCallOutput(output),
      type: 'function_call_output',
    };
    this.conversationItems.push(item);
  }

  appendUserInput(message: ResponseMessageItem): void {
    this.conversationItems.push(structuredClone(message));
  }

  appendUserMessage(text: string): void {
    this.appendUserInput(createUserMessage(text));
  }

  canCompact(): boolean {
    return this.conversationItems.length > 2;
  }

  getConversationItems(): ResponseInputItem[] {
    return structuredClone(this.conversationItems);
  }

  getInputItems(dynamicItems: ResponseInputItem[] = []): ResponseInputItem[] {
    return [...this.getScaffoldItems(dynamicItems), ...structuredClone(this.conversationItems)];
  }

  getScaffoldItems(dynamicItems: ResponseInputItem[] = []): ResponseInputItem[] {
    return [...structuredClone(this.scaffoldItems), ...structuredClone(dynamicItems)];
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

function cloneToolCallOutput(output: ToolCallOutput): ToolCallOutput {
  return Array.isArray(output) ? structuredClone(output) : output;
}
