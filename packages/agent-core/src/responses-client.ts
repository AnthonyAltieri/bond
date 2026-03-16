import type {
  ModelClient,
  ModelTurnEvent,
  ModelTurnParams,
  ModelTurnResult,
  ModelUsage,
  ResponseContentPart,
  ResponseFunctionCallItem,
  ResponseInputItem,
  ResponseMessageItem,
  ResponseReasoningItem,
  ToolCall,
} from './types.ts';

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
          .map((tool) => ({
            description: tool.description,
            name: tool.name,
            parameters: tool.inputSchema,
            strict: false,
            type: 'function',
          })),
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

function normalizeContentParts(value: unknown): ResponseContentPart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parts: ResponseContentPart[] = [];

  for (const part of value) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    const type = getString(part, 'type');
    const text = getString(part, 'text');

    if (!text || !type) {
      continue;
    }

    if (type === 'input_text' || type === 'output_text' || type === 'summary_text') {
      parts.push({ text, type });
    }
  }

  return parts;
}

function normalizeOutputItems(output: unknown): ResponseInputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  const items: ResponseInputItem[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const type = getString(item, 'type');

    if (type === 'message') {
      const role = getString(item, 'role');
      const content = normalizeContentParts(Reflect.get(item, 'content'));

      if ((role === 'assistant' || role === 'developer' || role === 'user') && content.length > 0) {
        items.push({ content, role, type: 'message' } satisfies ResponseMessageItem);
      }

      continue;
    }

    if (type === 'function_call') {
      const argumentsText = getString(item, 'arguments');
      const callId = getString(item, 'call_id');
      const name = getString(item, 'name');

      if (argumentsText && callId && name) {
        items.push({
          arguments: argumentsText,
          call_id: callId,
          name,
          type: 'function_call',
        } satisfies ResponseFunctionCallItem);
      }

      continue;
    }

    if (type === 'function_call_output') {
      const callId = getString(item, 'call_id');
      const outputText = getString(item, 'output');

      if (callId && outputText) {
        items.push({ call_id: callId, output: outputText, type: 'function_call_output' });
      }

      continue;
    }

    if (type === 'reasoning') {
      const summary = normalizeSummaryParts(Reflect.get(item, 'summary'));
      const encryptedContent = getString(item, 'encrypted_content');

      if (summary.length > 0 || encryptedContent) {
        items.push({
          encrypted_content: encryptedContent,
          summary: summary.length > 0 ? summary : undefined,
          type: 'reasoning',
        } satisfies ResponseReasoningItem);
      }
    }
  }

  return items;
}

function normalizeSummaryParts(value: unknown): ResponseReasoningItem['summary'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const summary = value
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return undefined;
      }

      const text = getString(part, 'text');
      const type = getString(part, 'type');

      return text && type === 'summary_text' ? { text, type } : undefined;
    })
    .filter((part) => part !== undefined);

  return summary;
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
  return items
    .filter((item): item is ResponseFunctionCallItem => item.type === 'function_call')
    .map((item) => ({ id: item.call_id, inputText: item.arguments, name: item.name }));
}

function getString(source: object, key: string): string | undefined {
  const value = Reflect.get(source, key);
  return typeof value === 'string' ? value : undefined;
}
