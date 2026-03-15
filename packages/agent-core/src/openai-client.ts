import type {
  Message,
  ModelClient,
  ModelTurnEvent,
  ModelStopReason,
  ModelTurnParams,
  ModelTurnResult,
} from './types.ts';

interface OpenAIChatClientOptions {
  apiKey: string;
  baseUrl?: string;
}

interface OpenAIChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        function?: { arguments?: string; name?: string };
        id?: string;
        index: number;
      }>;
    };
    finish_reason?: ModelStopReason | null;
  }>;
}

interface OpenAIChatError {
  error?: { message?: string };
}

interface PartialToolCall {
  id: string;
  inputText: string;
  name: string;
}

export class OpenAIChatClient implements ModelClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  constructor(options: OpenAIChatClientOptions) {
    if (!options.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async *streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: params.messages.map((message) => toOpenAIMessage(message)),
        model: params.model,
        stream: true,
        tools: params.tools.map((tool) => ({
          function: {
            description: tool.description,
            name: tool.name,
            parameters: tool.inputSchema,
          },
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
  const partialToolCalls: PartialToolCall[] = [];
  const textParts: string[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason: ModelStopReason = 'stop';

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value, { stream: !done });

    const events = splitSseEvents(buffer);
    buffer = events.rest;

    for (const event of events.items) {
      if (!event.startsWith('data:')) {
        continue;
      }

      const payload = parseSseData(event);

      if (!payload || payload === '[DONE]') {
        continue;
      }

      const chunk = JSON.parse(payload) as OpenAIChatCompletionChunk;
      const choice = chunk.choices?.[0];

      if (!choice) {
        continue;
      }

      if (choice.finish_reason) {
        stopReason = choice.finish_reason;
      }

      const content = choice.delta?.content;

      if (content) {
        textParts.push(content);
        yield { chunk: content, kind: 'text-delta' };
      }

      for (const toolCall of choice.delta?.tool_calls ?? []) {
        const current = partialToolCalls[toolCall.index] ?? { id: '', inputText: '', name: '' };

        current.id = toolCall.id ?? current.id;
        current.inputText += toolCall.function?.arguments ?? '';
        current.name = toolCall.function?.name ?? current.name;
        partialToolCalls[toolCall.index] = current;
      }
    }

    if (done) {
      break;
    }
  }

  return {
    stopReason,
    text: textParts.join(''),
    toolCalls: partialToolCalls
      .filter((toolCall) => toolCall.id && toolCall.name)
      .map((toolCall) => ({ id: toolCall.id, inputText: toolCall.inputText, name: toolCall.name })),
  };
}

async function formatOpenAIError(response: Response): Promise<string> {
  const bodyText = await response.text();

  try {
    const parsed = JSON.parse(bodyText) as OpenAIChatError;
    const message = parsed.error?.message;

    if (message) {
      return `OpenAI request failed (${response.status}): ${message}`;
    }
  } catch {
    // Ignore JSON parsing failures and fall through to the raw body.
  }

  return `OpenAI request failed (${response.status}): ${bodyText}`;
}

function parseSseData(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
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

function toOpenAIMessage(message: Message): Record<string, unknown> {
  if (message.role === 'tool') {
    return { content: message.content, role: 'tool', tool_call_id: message.toolCallId };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      content: message.content || null,
      role: 'assistant',
      tool_calls: message.toolCalls.map((toolCall) => ({
        function: { arguments: toolCall.inputText, name: toolCall.name },
        id: toolCall.id,
        type: 'function',
      })),
    };
  }

  return { content: message.content, role: message.role };
}
