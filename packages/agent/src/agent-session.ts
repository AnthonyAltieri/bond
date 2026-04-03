import { unwrap } from '@alt-stack/result';
import { createDefaultToolServices, type ToolServices } from '@bond/tools';

import { compactConversation } from './compactor.ts';
import { ConversationState, createUserMessage } from './conversation-state.ts';
import { buildPromptScaffold } from './prompt-scaffold.ts';
import { DEFAULT_SYSTEM_PROMPT } from './request-builder/system-prompt.ts';
import type { Tool, ToolDefinition, ToolEvent, ToolExecutionResult } from '@bond/tools/runtime';
import type {
  AgentEvent,
  AgentRunResult,
  AgentSessionSnapshot,
  AgentToolTraceEntry,
  ModelClient,
  ModelTurnEvent,
  ModelTurnResult,
  PlanSnapshot,
  ResponseMessageItem,
  ResponseInputItem,
  ToolCall,
} from './types.ts';

const DEFAULT_AUTO_COMPACT_TOKENS = 24_000;
const DEFAULT_MAX_STEPS = 16;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SHELL = 'sh';

export interface AgentSessionOptions {
  autoCompactTokenLimit?: number;
  client: ModelClient;
  commandTimeoutMs?: number;
  compactionModel?: string;
  cwd: string;
  initialConversationItems?: ResponseInputItem[];
  initialPlan?: PlanSnapshot;
  maxSteps?: number;
  model: string;
  reasoningEffort?: string;
  shell?: string;
  systemPrompt?: string;
  toolServices?: Partial<ToolServices>;
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

  private readonly reasoningEffort?: string;

  private readonly shell: string;

  private readonly state: ConversationState;

  private readonly toolServices?: ToolServices;

  private currentPlan?: PlanSnapshot;

  private pendingInitialPlan?: PlanSnapshot;

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
    this.reasoningEffort = options.reasoningEffort;
    this.shell = options.shell ?? DEFAULT_SHELL;
    this.toolServices = options.toolServices
      ? createDefaultToolServices(options.toolServices)
      : undefined;
    this.toolDefinitions = tools.map((tool) => tool.definition);
    this.toolMap = new Map(tools.map((tool) => [tool.definition.name, tool]));
    this.pendingInitialPlan = clonePlan(options.initialPlan);
    this.state = new ConversationState(
      unwrap(
        buildPromptScaffold({
          cwd: this.cwd,
          shell: this.shell,
          toolDefinitions: this.toolDefinitions,
        }),
      ),
      options.initialConversationItems,
    );
  }

  async run(prompt: string): Promise<AgentRunResult> {
    return await this.runMessage(createUserMessage(prompt));
  }

  async runMessage(message: ResponseMessageItem): Promise<AgentRunResult> {
    const iterator = this.streamMessage(message);

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        return next.value;
      }
    }
  }

  async *stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult> {
    return yield* this.streamMessage(createUserMessage(prompt));
  }

  async *streamMessage(message: ResponseMessageItem): AsyncGenerator<AgentEvent, AgentRunResult> {
    this.currentPlan = clonePlan(this.pendingInitialPlan);
    this.pendingInitialPlan = undefined;
    this.state.appendUserInput(message);

    let compactionsUsed = 0;
    let finalText = '';
    const toolTrace: AgentToolTraceEntry[] = [];

    for (let step = 0; step < this.maxSteps; step += 1) {
      const dynamicItems = getDynamicPromptItems(this.currentPlan);
      const inputItems = this.state.getInputItems(dynamicItems);

      if (
        shouldCompact(
          this.instructions,
          this.toolDefinitions,
          inputItems,
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
          scaffoldItems: this.state.getScaffoldItems(dynamicItems),
        });

        this.state.replaceConversation(compaction.replacementItems);
        compactionsUsed += 1;
        yield { kind: 'compaction-complete', summary: compaction.summary };
      }

      const modelResult = yield* this.streamModelTurn(
        this.state.getInputItems(getDynamicPromptItems(this.currentPlan)),
      );
      finalText = modelResult.assistantText;
      this.state.appendResponseItems(modelResult.items);

      if (modelResult.toolCalls.length === 0) {
        const result = {
          compactionsUsed,
          finalText,
          inputItems: this.state.getInputItems(getDynamicPromptItems(this.currentPlan)),
          plan: clonePlan(this.currentPlan),
          stepsUsed: step + 1,
          stopReason: 'completed',
          toolTrace: structuredClone(toolTrace),
        } satisfies AgentRunResult;

        yield { kind: 'end', result };
        return result;
      }

      for (const toolCall of modelResult.toolCalls) {
        yield { call: toolCall, kind: 'tool-call' };

        const toolResult = yield* this.streamToolCall(toolCall);
        this.state.appendToolOutput(toolCall, toolResult.output ?? toolResult.content);
        toolTrace.push({
          callId: toolCall.id,
          inputText: toolCall.inputText,
          kind: toolCall.kind,
          name: toolCall.name,
          summary: toolResult.summary,
        });

        yield { call: toolCall, kind: 'tool-result', result: toolResult };

        const plan = extractPlanSnapshot(toolResult);

        if (plan) {
          this.currentPlan = plan;
          yield { kind: 'plan-update', plan: structuredClone(plan) };
        }
      }
    }

    const result = {
      compactionsUsed,
      finalText,
      inputItems: this.state.getInputItems(getDynamicPromptItems(this.currentPlan)),
      plan: clonePlan(this.currentPlan),
      stepsUsed: this.maxSteps,
      stopReason: 'max_steps',
      toolTrace: structuredClone(toolTrace),
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
      reasoningEffort: this.reasoningEffort,
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
      sessionSnapshot: this.getSessionSnapshot(),
      shell: this.shell,
      services: this.toolServices,
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

  private getSessionSnapshot(): AgentSessionSnapshot {
    return {
      conversationItems: this.state.getConversationItems(),
      currentPlan: clonePlan(this.currentPlan),
    };
  }
}

async function* runToolCall(
  call: ToolCall,
  tool: Tool | undefined,
  context: {
    callId: string;
    cwd: string;
    defaultTimeoutMs: number;
    sessionSnapshot?: AgentSessionSnapshot;
    shell: string;
    services?: ToolServices;
    workspaceRoot: string;
  },
): AsyncGenerator<ToolEvent, ToolExecutionResult> {
  if (!tool) {
    return {
      content: JSON.stringify({ error: `Unknown tool "${call.name}"` }, null, 2),
      name: call.name,
      output: JSON.stringify({ error: `Unknown tool "${call.name}"` }, null, 2),
      summary: 'unknown tool',
    };
  }

  try {
    return yield* tool.stream(call.inputText, context);
  } catch (error) {
    return {
      content: JSON.stringify({ error: toErrorMessage(error) }, null, 2),
      name: call.name,
      output: JSON.stringify({ error: toErrorMessage(error) }, null, 2),
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

function clonePlan(plan: PlanSnapshot | undefined): PlanSnapshot | undefined {
  return plan ? structuredClone(plan) : undefined;
}

function extractPlanSnapshot(result: ToolExecutionResult): PlanSnapshot | undefined {
  if (!isPlanToolName(result.name) || !result.metadata) {
    return undefined;
  }

  const plan = Reflect.get(result.metadata, 'plan');

  return isPlanSnapshot(plan) ? structuredClone(plan) : undefined;
}

function formatCurrentPlan(plan: PlanSnapshot): string {
  const lines = ['<current_plan>'];

  if (plan.explanation) {
    lines.push(`Explanation: ${plan.explanation}`);
  }

  lines.push('Steps:');
  lines.push(...plan.steps.map((entry) => `- [${entry.status}] ${entry.step}`));
  lines.push('</current_plan>');

  return lines.join('\n');
}

function getDynamicPromptItems(plan: PlanSnapshot | undefined): ResponseInputItem[] {
  if (!plan) {
    return [];
  }

  return [createCurrentPlanMessage(plan)];
}

function createCurrentPlanMessage(plan: PlanSnapshot): ResponseMessageItem {
  return createUserMessage(formatCurrentPlan(plan));
}

function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const steps = Reflect.get(value, 'steps');
  const explanation = Reflect.get(value, 'explanation');

  if (!Array.isArray(steps)) {
    return false;
  }

  if (explanation !== undefined && typeof explanation !== 'string') {
    return false;
  }

  return steps.every(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof Reflect.get(entry, 'step') === 'string' &&
      isPlanStepStatus(Reflect.get(entry, 'status')),
  );
}

function isPlanStepStatus(value: unknown): value is PlanSnapshot['steps'][number]['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function isPlanToolName(name: string): boolean {
  return name === 'update_plan' || name === 'functions.update_plan';
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
