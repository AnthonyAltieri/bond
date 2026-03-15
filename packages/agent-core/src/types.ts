export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  content: string;
  name: string;
  toolCallId: string;
}

export interface ToolCall {
  id: string;
  inputText: string;
  name: string;
}

export interface JsonSchema {
  [key: string]: JsonSchemaValue;
}

type JsonSchemaValue = JsonSchema | JsonSchema[] | boolean | null | number | string;

export interface ToolDefinition {
  description: string;
  inputSchema: JsonSchema;
  name: string;
}

export interface ToolExecutionContext {
  callId: string;
  cwd: string;
  defaultTimeoutMs: number;
  workspaceRoot: string;
}

export interface ToolExecutionResult {
  content: string;
  metadata?: Record<string, unknown>;
  name: string;
  summary: string;
}

export type ToolEvent =
  | { chunk: string; kind: 'stderr-delta' }
  | { chunk: string; kind: 'stdout-delta' };

export interface Tool {
  definition: ToolDefinition;
  execute(inputText: string, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  stream(
    inputText: string,
    context: ToolExecutionContext,
  ): AsyncGenerator<ToolEvent, ToolExecutionResult>;
}

export interface ModelTurnParams {
  messages: Message[];
  model: string;
  tools: ToolDefinition[];
}

export type ModelStopReason = 'length' | 'stop' | 'tool_calls';

export interface ModelTextDeltaEvent {
  chunk: string;
  kind: 'text-delta';
}

export type ModelTurnEvent = ModelTextDeltaEvent;

export interface ModelTurnResult {
  stopReason: ModelStopReason;
  text: string;
  toolCalls: ToolCall[];
}

export interface ModelClient {
  streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult>;
}

export type AgentStopReason = 'completed' | 'max_steps';

export interface AgentRunResult {
  finalText: string;
  messages: Message[];
  stepsUsed: number;
  stopReason: AgentStopReason;
}

export type AgentEvent =
  | { chunk: string; kind: 'text-delta' }
  | { call: ToolCall; kind: 'tool-call' }
  | { call: ToolCall; chunk: string; kind: 'tool-stderr' }
  | { call: ToolCall; chunk: string; kind: 'tool-stdout' }
  | { call: ToolCall; kind: 'tool-result'; result: ToolExecutionResult }
  | { kind: 'end'; result: AgentRunResult };
