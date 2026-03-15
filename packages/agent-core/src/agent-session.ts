import type {
  AgentEvent,
  AgentRunResult,
  AssistantMessage,
  Message,
  ModelClient,
  ModelTurnResult,
  Tool,
  ToolCall,
  ToolEvent,
  ToolExecutionResult,
} from './types.ts';

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_TIMEOUT_MS = 15_000;

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a minimal coding agent running inside a local CLI.',
  'Use the shell tool when direct inspection or command execution is useful.',
  'Keep answers concise and avoid unnecessary tool calls.',
  'When a tool result is enough to answer, respond directly.',
].join(' ');

export interface AgentSessionOptions {
  client: ModelClient;
  commandTimeoutMs?: number;
  cwd: string;
  maxSteps?: number;
  model: string;
  systemPrompt?: string;
  tools: Tool[];
}

export class AgentSession {
  private readonly client: ModelClient;

  private readonly commandTimeoutMs: number;

  private readonly cwd: string;

  private readonly maxSteps: number;

  private readonly messages: Message[];

  private readonly model: string;

  private readonly toolMap: Map<string, Tool>;

  constructor(options: AgentSessionOptions) {
    this.client = options.client;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cwd = options.cwd;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.model = options.model;
    this.messages = [
      {
        content: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        role: 'system',
      },
    ];
    this.toolMap = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
  }

  async run(prompt: string): Promise<AgentRunResult> {
    const iterator = this.stream(prompt);

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        return next.value;
      }
    }
  }

  async *stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult> {
    this.messages.push({
      content: prompt,
      role: 'user',
    });

    let finalText = '';

    for (let step = 0; step < this.maxSteps; step += 1) {
      const modelResult = yield* this.streamModelTurn();

      finalText = modelResult.text;
      this.messages.push(toAssistantMessage(modelResult.text, modelResult.toolCalls));

      if (modelResult.toolCalls.length === 0) {
        const result = {
          finalText,
          messages: this.snapshotMessages(),
          stepsUsed: step + 1,
          stopReason: 'completed',
        };

        yield {
          kind: 'end',
          result,
        };

        return result;
      }

      for (const toolCall of modelResult.toolCalls) {
        yield {
          call: toolCall,
          kind: 'tool-call',
        };

        const result = yield* this.streamToolCall(toolCall);
        this.messages.push({
          content: result.content,
          name: toolCall.name,
          role: 'tool',
          toolCallId: toolCall.id,
        });

        yield {
          call: toolCall,
          kind: 'tool-result',
          result,
        };
      }
    }

    const result = {
      finalText,
      messages: this.snapshotMessages(),
      stepsUsed: this.maxSteps,
      stopReason: 'max_steps',
    };

    yield {
      kind: 'end',
      result,
    };

    return result;
  }

  snapshotMessages(): Message[] {
    return structuredClone(this.messages);
  }

  private async *streamModelTurn(): AsyncGenerator<AgentEvent, ModelTurnResult> {
    const iterator = this.client.streamTurn({
      messages: this.messages,
      model: this.model,
      tools: [...this.toolMap.values()].map((tool) => tool.definition),
    });

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        return next.value;
      }

      yield {
        chunk: next.value.chunk,
        kind: 'text-delta',
      };
    }
  }

  private async *streamToolCall(call: ToolCall): AsyncGenerator<AgentEvent, ToolExecutionResult> {
    const iterator = runToolCall(call, this.toolMap.get(call.name), {
      callId: call.id,
      cwd: this.cwd,
      defaultTimeoutMs: this.commandTimeoutMs,
      workspaceRoot: this.cwd,
    });

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        return next.value;
      }

      yield toAgentToolEvent(call, next.value);
    }
  }
}

async function* runToolCall(
  call: ToolCall,
  tool: Tool | undefined,
  context: {
    callId: string;
    cwd: string;
    defaultTimeoutMs: number;
    workspaceRoot: string;
  },
): AsyncGenerator<ToolEvent, ToolExecutionResult> {
  if (!tool) {
    return {
      content: JSON.stringify(
        {
          error: `Unknown tool "${call.name}"`,
        },
        null,
        2,
      ),
      name: call.name,
      summary: 'unknown tool',
    };
  }

  try {
    return yield* tool.stream(call.inputText, context);
  } catch (error) {
    return {
      content: JSON.stringify(
        {
          error: toErrorMessage(error),
        },
        null,
        2,
      ),
      name: call.name,
      summary: `error: ${toErrorMessage(error)}`,
    };
  }
}

function toAssistantMessage(text: string, toolCalls: ToolCall[]): AssistantMessage {
  return toolCalls.length
    ? {
        content: text,
        role: 'assistant',
        toolCalls,
      }
    : {
        content: text,
        role: 'assistant',
      };
}

function toAgentToolEvent(call: ToolCall, event: ToolEvent): AgentEvent {
  return event.kind === 'stdout-delta'
    ? {
        call,
        chunk: event.chunk,
        kind: 'tool-stdout',
      }
    : {
        call,
        chunk: event.chunk,
        kind: 'tool-stderr',
      };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
