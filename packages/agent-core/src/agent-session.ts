import { compactConversation } from './compactor.ts';
import { ConversationState } from './conversation-state.ts';
import { buildPromptScaffold } from './prompt-scaffold.ts';
import type {
  AgentEvent,
  AgentRunResult,
  ModelClient,
  ModelTurnEvent,
  ModelTurnResult,
  ResponseInputItem,
  Tool,
  ToolCall,
  ToolDefinition,
  ToolEvent,
  ToolExecutionResult,
} from './types.ts';

const DEFAULT_AUTO_COMPACT_TOKENS = 24_000;
const DEFAULT_MAX_STEPS = 6;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SHELL = 'sh';

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a minimal coding agent running inside a local CLI.',
  'Use the shell tool when direct inspection or command execution is useful.',
  'Keep answers concise and avoid unnecessary tool calls.',
  'When a tool result is enough to answer, respond directly.',
].join(' ');

export interface AgentSessionOptions {
  autoCompactTokenLimit?: number;
  client: ModelClient;
  commandTimeoutMs?: number;
  compactionModel?: string;
  cwd: string;
  maxSteps?: number;
  model: string;
  shell?: string;
  systemPrompt?: string;
  tools: Tool[];
}

export class AgentSession {
  private readonly autoCompactTokenLimit: number;

  private readonly client: ModelClient;

  private readonly commandTimeoutMs: number;

  private readonly compactionModel: string;

  private readonly cwd: string;

  private readonly instructions: string;

  private readonly maxSteps: number;

  private readonly model: string;

  private readonly shell: string;

  private readonly state: ConversationState;

  private readonly toolDefinitions: ToolDefinition[];

  private readonly toolMap: Map<string, Tool>;

  constructor(options: AgentSessionOptions) {
    const tools = [...options.tools].sort((left, right) =>
      left.definition.name.localeCompare(right.definition.name),
    );

    this.autoCompactTokenLimit = options.autoCompactTokenLimit ?? DEFAULT_AUTO_COMPACT_TOKENS;
    this.client = options.client;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.compactionModel = options.compactionModel ?? options.model;
    this.cwd = options.cwd;
    this.instructions = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.model = options.model;
    this.shell = options.shell ?? DEFAULT_SHELL;
    this.toolDefinitions = tools.map((tool) => tool.definition);
    this.toolMap = new Map(tools.map((tool) => [tool.definition.name, tool]));
    this.state = new ConversationState(
      buildPromptScaffold({ cwd: this.cwd, shell: this.shell }),
    );
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
    this.state.appendUserMessage(prompt);

    let compactionsUsed = 0;
    let finalText = '';

    for (let step = 0; step < this.maxSteps; step += 1) {
      if (
        shouldCompact(
          this.instructions,
          this.toolDefinitions,
          this.state.getInputItems(),
          this.autoCompactTokenLimit,
          this.state.canCompact(),
        )
      ) {
        yield { kind: 'compaction-start' };

        const compaction = await compactConversation({
          client: this.client,
          conversationItems: this.state.getConversationItems(),
          instructions: this.instructions,
          model: this.compactionModel,
          scaffoldItems: getScaffoldItems(
            this.state.getInputItems(),
            this.state.getConversationItems(),
          ),
        });

        this.state.replaceConversation(compaction.replacementItems);
        compactionsUsed += 1;
        yield { kind: 'compaction-complete', summary: compaction.summary };
      }

      const modelResult = yield* this.streamModelTurn(this.state.getInputItems());
      finalText = modelResult.assistantText;
      this.state.appendResponseItems(modelResult.items);

      if (modelResult.toolCalls.length === 0) {
        const result = {
          compactionsUsed,
          finalText,
          inputItems: this.state.getInputItems(),
          stepsUsed: step + 1,
          stopReason: 'completed',
        } satisfies AgentRunResult;

        yield { kind: 'end', result };
        return result;
      }

      for (const toolCall of modelResult.toolCalls) {
        yield { call: toolCall, kind: 'tool-call' };

        const toolResult = yield* this.streamToolCall(toolCall);
        this.state.appendToolOutput(toolCall.id, toolResult.content);

        yield { call: toolCall, kind: 'tool-result', result: toolResult };
      }
    }

    const result = {
      compactionsUsed,
      finalText,
      inputItems: this.state.getInputItems(),
      stepsUsed: this.maxSteps,
      stopReason: 'max_steps',
    } satisfies AgentRunResult;

    yield { kind: 'end', result };
    return result;
  }

  private async *streamModelTurn(
    input: ResponseInputItem[],
  ): AsyncGenerator<AgentEvent, ModelTurnResult> {
    const iterator = this.client.streamTurn({
      input,
      instructions: this.instructions,
      model: this.model,
      tools: this.toolDefinitions,
    });

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        return next.value;
      }

      yield toAgentModelEvent(next.value);
    }
  }

  private async *streamToolCall(call: ToolCall): AsyncGenerator<AgentEvent, ToolExecutionResult> {
    const iterator = runToolCall(call, this.toolMap.get(call.name), {
      callId: call.id,
      cwd: this.cwd,
      defaultTimeoutMs: this.commandTimeoutMs,
      shell: this.shell,
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
    shell: string;
    workspaceRoot: string;
  },
): AsyncGenerator<ToolEvent, ToolExecutionResult> {
  if (!tool) {
    return {
      content: JSON.stringify({ error: `Unknown tool "${call.name}"` }, null, 2),
      name: call.name,
      summary: 'unknown tool',
    };
  }

  try {
    return yield* tool.stream(call.inputText, context);
  } catch (error) {
    return {
      content: JSON.stringify({ error: toErrorMessage(error) }, null, 2),
      name: call.name,
      summary: `error: ${toErrorMessage(error)}`,
    };
  }
}

function estimateTokens(
  instructions: string,
  tools: ToolDefinition[],
  input: ResponseInputItem[],
): number {
  return Math.ceil(JSON.stringify({ input, instructions, tools }).length / 4);
}

function getScaffoldItems(
  inputItems: ResponseInputItem[],
  conversationItems: ResponseInputItem[],
): ResponseInputItem[] {
  return structuredClone(inputItems.slice(0, inputItems.length - conversationItems.length));
}

function shouldCompact(
  instructions: string,
  tools: ToolDefinition[],
  input: ResponseInputItem[],
  tokenLimit: number,
  canCompact: boolean,
): boolean {
  return canCompact && estimateTokens(instructions, tools, input) > tokenLimit;
}

function toAgentModelEvent(event: ModelTurnEvent): AgentEvent {
  return event.kind === 'reasoning-delta'
    ? { chunk: event.chunk, kind: 'reasoning-delta' }
    : { chunk: event.chunk, kind: 'text-delta' };
}

function toAgentToolEvent(call: ToolCall, event: ToolEvent): AgentEvent {
  return event.kind === 'stdout-delta'
    ? { call, chunk: event.chunk, kind: 'tool-stdout' }
    : { call, chunk: event.chunk, kind: 'tool-stderr' };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
