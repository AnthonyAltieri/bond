import type {
  AgentHooks,
  AgentRunResult,
  AssistantMessage,
  Message,
  ModelClient,
  Tool,
  ToolCall,
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

  async run(prompt: string, hooks: AgentHooks = {}): Promise<AgentRunResult> {
    this.messages.push({
      content: prompt,
      role: 'user',
    });

    let finalText = '';

    for (let step = 0; step < this.maxSteps; step += 1) {
      const modelResult = await this.client.runTurn({
        messages: this.messages,
        model: this.model,
        onTextDelta: hooks.onTextDelta,
        tools: [...this.toolMap.values()].map((tool) => tool.definition),
      });

      finalText = modelResult.text;
      this.messages.push(toAssistantMessage(modelResult.text, modelResult.toolCalls));

      if (modelResult.toolCalls.length === 0) {
        return {
          finalText,
          messages: this.snapshotMessages(),
          stepsUsed: step + 1,
          stopReason: 'completed',
        };
      }

      for (const toolCall of modelResult.toolCalls) {
        hooks.onToolStart?.(toolCall);
        const result = await runToolCall(toolCall, this.toolMap.get(toolCall.name), {
          callId: toolCall.id,
          cwd: this.cwd,
          defaultTimeoutMs: this.commandTimeoutMs,
          workspaceRoot: this.cwd,
        });

        hooks.onToolResult?.(toolCall, result);
        this.messages.push({
          content: result.content,
          name: toolCall.name,
          role: 'tool',
          toolCallId: toolCall.id,
        });
      }
    }

    return {
      finalText,
      messages: this.snapshotMessages(),
      stepsUsed: this.maxSteps,
      stopReason: 'max_steps',
    };
  }

  snapshotMessages(): Message[] {
    return structuredClone(this.messages);
  }
}

async function runToolCall(
  call: ToolCall,
  tool: Tool | undefined,
  context: {
    callId: string;
    cwd: string;
    defaultTimeoutMs: number;
    workspaceRoot: string;
  },
): Promise<ToolExecutionResult> {
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
    return await tool.execute(call.inputText, context);
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
