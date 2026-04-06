import type {
  ModelClient,
  ModelTurnEvent,
  ModelTurnParams,
  ModelTurnResult,
  ResponseMessageItem,
} from './types.ts';
import {
  createToolNameMap,
  normalizeOutputItems,
  parseSseData,
  readAssistantText,
  type OpenAIResponsesError,
  type ResponseCompletedEvent,
  type ResponseDeltaEvent,
  serializeInputItems,
  splitSseEvents,
  toToolCalls,
} from './responses-protocol.ts';

interface OpenAIResponsesClientOptions {
  apiKey: string;
  baseUrl?: string;
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
    const nameMap = createToolNameMap(params.tools);
    const response = await fetch(`${this.baseUrl}/responses`, {
      body: JSON.stringify({
        input: serializeInputItems(params.input, nameMap),
        instructions: params.instructions,
        model: params.model,
        ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
        stream: true,
        tools: [...params.tools]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((tool) =>
            tool.kind === 'custom'
              ? {
                  description: tool.description,
                  format: tool.format,
                  name: nameMap.toApiName.get(tool.name) ?? tool.name,
                  type: 'custom',
                }
              : {
                  description: tool.description,
                  name: nameMap.toApiName.get(tool.name) ?? tool.name,
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

    return yield* collectStream(response.body, nameMap.toLocalName);
  }
}

async function* collectStream(
  stream: ReadableStream<Uint8Array>,
  toolNameMap: ReadonlyMap<string, string>,
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

      if (
        parsed.type === 'response.output_text.delta' &&
        'delta' in parsed &&
        typeof parsed.delta === 'string'
      ) {
        textParts.push(parsed.delta);
        yield { chunk: parsed.delta, kind: 'text-delta' };
        continue;
      }

      if (
        parsed.type === 'response.reasoning_summary_text.delta' &&
        'delta' in parsed &&
        typeof parsed.delta === 'string'
      ) {
        yield { chunk: parsed.delta, kind: 'reasoning-delta' };
        continue;
      }

      if (parsed.type === 'response.completed' && 'response' in parsed) {
        completed = parsed.response;
      }
    }

    if (done) {
      break;
    }
  }

  const items = normalizeOutputItems(completed?.output, toolNameMap);
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

function toAssistantMessage(text: string): ResponseMessageItem {
  return { content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' };
}
