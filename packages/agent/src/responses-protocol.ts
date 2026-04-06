import { z } from 'zod';

import type {
  ModelTurnParams,
  ModelUsage,
  ResponseCustomToolCallItem,
  ResponseFunctionCallItem,
  ResponseInputItem,
  ResponseMessageItem,
  ResponseReasoningItem,
  ToolCall,
} from './types.ts';

export interface OpenAIResponsesError {
  error?: { message?: string };
}

export interface ResponseCompletedEvent {
  response?: { output?: unknown; usage?: ModelUsage };
  type?: string;
}

export interface ResponseDeltaEvent {
  delta?: string;
  type?: string;
}

const ResponseContentPartSchema = z.discriminatedUnion('type', [
  z.object({
    detail: z.string().nullable().optional(),
    image_url: z.string(),
    type: z.literal('input_image'),
  }),
  z.object({ text: z.string(), type: z.literal('input_text') }),
  z.object({ text: z.string(), type: z.literal('output_text') }),
  z.object({ text: z.string(), type: z.literal('summary_text') }),
]);

const ResponseMessageItemSchema = z.object({
  content: z.array(ResponseContentPartSchema).min(1),
  role: z.enum(['assistant', 'developer', 'user']),
  type: z.literal('message'),
});

const ResponseFunctionCallItemSchema = z.object({
  arguments: z.string(),
  call_id: z.string(),
  name: z.string(),
  type: z.literal('function_call'),
});

const ResponseCustomToolCallItemSchema = z.object({
  call_id: z.string(),
  input: z.string(),
  name: z.string(),
  type: z.literal('custom_tool_call'),
});

const ResponseFunctionCallOutputItemSchema = z.object({
  call_id: z.string(),
  output: z.union([z.string(), z.array(ResponseContentPartSchema)]),
  type: z.literal('function_call_output'),
});

const ResponseCustomToolCallOutputItemSchema = z.object({
  call_id: z.string(),
  output: z.union([z.string(), z.array(ResponseContentPartSchema)]),
  type: z.literal('custom_tool_call_output'),
});

const ResponseReasoningItemSchema = z
  .object({
    encrypted_content: z.string().optional(),
    summary: z
      .array(z.object({ text: z.string(), type: z.literal('summary_text') }))
      .min(1)
      .optional(),
    type: z.literal('reasoning'),
  })
  .refine((item) => item.summary !== undefined || item.encrypted_content !== undefined);

export function normalizeOutputItems(
  output: unknown,
  toolNameMap: ReadonlyMap<string, string>,
): ResponseInputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => parseOutputItem(item, toolNameMap));
}

export function parseSseData(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

export function readAssistantText(items: ResponseInputItem[]): string {
  return items
    .filter(
      (item): item is ResponseMessageItem => item.type === 'message' && item.role === 'assistant',
    )
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');
}

export function splitSseEvents(buffer: string): { items: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const items: string[] = [];
  let searchIndex = 0;

  while (true) {
    const boundaryIndex = normalized.indexOf('\n\n', searchIndex);

    if (boundaryIndex === -1) {
      break;
    }

    items.push(normalized.slice(searchIndex, boundaryIndex));
    searchIndex = boundaryIndex + 2;
  }

  return { items, rest: normalized.slice(searchIndex) };
}

export function toToolCalls(items: ResponseInputItem[]): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const item of items) {
    if (item.type === 'function_call') {
      calls.push({
        id: item.call_id,
        inputText: item.arguments,
        kind: 'function',
        name: item.name,
      });
      continue;
    }

    if (item.type === 'custom_tool_call') {
      calls.push({ id: item.call_id, inputText: item.input, kind: 'custom', name: item.name });
    }
  }

  return calls;
}

export function serializeInputItems(
  input: ResponseInputItem[],
  nameMap: ToolNameMap,
): ResponseInputItem[] {
  return input.map((item) => {
    if (item.type === 'function_call') {
      return { ...item, name: nameMap.toApiName.get(item.name) ?? item.name };
    }

    if (item.type === 'custom_tool_call') {
      return { ...item, name: nameMap.toApiName.get(item.name) ?? item.name };
    }

    return item;
  });
}

export interface ToolNameMap {
  toApiName: Map<string, string>;
  toLocalName: Map<string, string>;
}

export function createToolNameMap(tools: ModelTurnParams['tools']): ToolNameMap {
  const toApiName = new Map<string, string>();
  const toLocalName = new Map<string, string>();

  for (const tool of tools) {
    const apiName = tool.name.replaceAll(
      /[^a-zA-Z0-9_-]/g,
      (character) => `_u${character.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000'}_`,
    );
    const existing = toLocalName.get(apiName);

    if (existing && existing !== tool.name) {
      throw new Error(
        `Tool names "${existing}" and "${tool.name}" collide after API name sanitization`,
      );
    }

    toApiName.set(tool.name, apiName);
    toLocalName.set(apiName, tool.name);
  }

  return { toApiName, toLocalName };
}

function parseOutputItem(
  item: unknown,
  toolNameMap: ReadonlyMap<string, string>,
): ResponseInputItem[] {
  const itemType = z.object({ type: z.string() }).safeParse(item);

  if (!itemType.success) {
    return [];
  }

  switch (itemType.data.type) {
    case 'message': {
      const parsed = ResponseMessageItemSchema.safeParse(item);
      return parsed.success ? [parsed.data satisfies ResponseMessageItem] : [];
    }
    case 'function_call': {
      const parsed = ResponseFunctionCallItemSchema.safeParse(item);
      return parsed.success
        ? [
            {
              ...parsed.data,
              name: toolNameMap.get(parsed.data.name) ?? parsed.data.name,
            } satisfies ResponseFunctionCallItem,
          ]
        : [];
    }
    case 'custom_tool_call': {
      const parsed = ResponseCustomToolCallItemSchema.safeParse(item);
      return parsed.success
        ? [
            {
              ...parsed.data,
              name: toolNameMap.get(parsed.data.name) ?? parsed.data.name,
            } satisfies ResponseCustomToolCallItem,
          ]
        : [];
    }
    case 'function_call_output': {
      const parsed = ResponseFunctionCallOutputItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }
    case 'custom_tool_call_output': {
      const parsed = ResponseCustomToolCallOutputItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }
    case 'reasoning': {
      const parsed = ResponseReasoningItemSchema.safeParse(item);
      return parsed.success ? [parsed.data satisfies ResponseReasoningItem] : [];
    }
    default:
      return [];
  }
}
