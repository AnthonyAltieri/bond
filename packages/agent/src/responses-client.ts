import type {
  ResponseCustomToolCallItem,
  ModelClient,
  ModelTurnEvent,
  ModelTurnParams,
  ModelTurnResult,
  ModelUsage,
  ResponseFunctionCallItem,
  ResponseInputItem,
  ResponseMessageItem,
  ResponseReasoningItem,
  ToolCall,
} from './types.ts';
import { z } from 'zod';

interface OpenAIResponsesClientOptions {
  apiKey: string;
  baseUrl?: string;
}

interface OpenAIResponsesError {
  error?: { message?: string };
}

interface ResponseCompletedEvent {
  response?: { output?: unknown; usage?: ModelUsage };
  type?: string;
}

interface ResponseDeltaEvent {
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

export class OpenAIResponsesClient implements ModelClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  constructor(options: OpenAIResponsesClientOptions) {
    if (!options.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async *streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      body: JSON.stringify({
        input: params.input,
        instructions: params.instructions,
        model: params.model,
        stream: true,
        tools: [...params.tools]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((tool) =>
            tool.kind === 'custom'
              ? {
                  description: tool.description,
                  format: tool.format,
                  name: tool.name,
                  type: 'custom',
                }
              : {
                  description: tool.description,
                  name: tool.name,
                  parameters: tool.inputSchema,
                  strict: false,
                  type: 'function',
                },
          ),
      }),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(await formatOpenAIError(response));
    }

    if (!response.body) {
      throw new Error('OpenAI did not return a response body');
    }

    return yield* collectStream(response.body);
  }
}

async function* collectStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const textParts: string[] = [];
  let buffer = '';
  let completed: ResponseCompletedEvent['response'];

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value, { stream: !done });

    const events = splitSseEvents(buffer);
    buffer = events.rest;

    for (const event of events.items) {
      const payload = parseSseData(event);

      if (!payload || payload === '[DONE]') {
        continue;
      }

      const parsed = JSON.parse(payload) as ResponseCompletedEvent | ResponseDeltaEvent;

      if (parsed.type === 'response.output_text.delta' && parsed.delta) {
        textParts.push(parsed.delta);
        yield { chunk: parsed.delta, kind: 'text-delta' };
        continue;
      }

      if (parsed.type === 'response.reasoning_summary_text.delta' && parsed.delta) {
        yield { chunk: parsed.delta, kind: 'reasoning-delta' };
        continue;
      }

      if (parsed.type === 'response.completed') {
        completed = parsed.response;
      }
    }

    if (done) {
      break;
    }
  }

  const items = normalizeOutputItems(completed?.output);
  const assistantText = readAssistantText(items) || textParts.join('');

  return {
    assistantText,
    items: items.length > 0 ? items : assistantText ? [toAssistantMessage(assistantText)] : [],
    toolCalls: toToolCalls(items),
    usage: completed?.usage,
  };
}

async function formatOpenAIError(response: Response): Promise<string> {
  const bodyText = await response.text();

  try {
    const parsed = JSON.parse(bodyText) as OpenAIResponsesError;
    const message = parsed.error?.message;

    if (message) {
      return `OpenAI request failed (${response.status}): ${message}`;
    }
  } catch {
    // Ignore JSON parsing failures and fall through to the raw body.
  }

  return `OpenAI request failed (${response.status}): ${bodyText}`;
}

function normalizeOutputItems(output: unknown): ResponseInputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => parseOutputItem(item));
}

function parseSseData(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

function readAssistantText(items: ResponseInputItem[]): string {
  return items
    .filter(
      (item): item is ResponseMessageItem => item.type === 'message' && item.role === 'assistant',
    )
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');
}

function splitSseEvents(buffer: string): { items: string[]; rest: string } {
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

function toAssistantMessage(text: string): ResponseMessageItem {
  return { content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' };
}

function toToolCalls(items: ResponseInputItem[]): ToolCall[] {
  return items.flatMap((item) => {
    if (item.type === 'function_call') {
      return [{ id: item.call_id, inputText: item.arguments, kind: 'function', name: item.name }];
    }

    if (item.type === 'custom_tool_call') {
      return [{ id: item.call_id, inputText: item.input, kind: 'custom', name: item.name }];
    }

    return [];
  });
}

function parseOutputItem(item: unknown): ResponseInputItem[] {
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
      return parsed.success ? [parsed.data satisfies ResponseFunctionCallItem] : [];
    }
    case 'custom_tool_call': {
      const parsed = ResponseCustomToolCallItemSchema.safeParse(item);
      return parsed.success ? [parsed.data satisfies ResponseCustomToolCallItem] : [];
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
