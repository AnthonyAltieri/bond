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
  shell: string;
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

export interface ResponseInputTextPart {
  text: string;
  type: 'input_text';
}

export interface ResponseOutputTextPart {
  text: string;
  type: 'output_text';
}

export interface ResponseSummaryTextPart {
  text: string;
  type: 'summary_text';
}

export type ResponseContentPart =
  | ResponseInputTextPart
  | ResponseOutputTextPart
  | ResponseSummaryTextPart;

export interface ResponseMessageItem {
  content: ResponseContentPart[];
  role: 'assistant' | 'developer' | 'user';
  type: 'message';
}

export interface ResponseReasoningItem {
  encrypted_content?: string;
  summary?: ResponseSummaryTextPart[];
  type: 'reasoning';
}

export interface ResponseFunctionCallItem {
  arguments: string;
  call_id: string;
  name: string;
  type: 'function_call';
}

export interface ResponseFunctionCallOutputItem {
  call_id: string;
  output: string;
  type: 'function_call_output';
}

export type ResponseInputItem =
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem
  | ResponseMessageItem
  | ResponseReasoningItem;

export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface ModelTurnParams {
  input: ResponseInputItem[];
  instructions: string;
  model: string;
  tools: ToolDefinition[];
}

export type ModelTurnEvent =
  | { chunk: string; kind: 'reasoning-delta' }
  | { chunk: string; kind: 'text-delta' };

export interface ModelTurnResult {
  assistantText: string;
  items: ResponseInputItem[];
  toolCalls: ToolCall[];
  usage?: ModelUsage;
}

export interface ModelClient {
  streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult>;
}

export type AgentStopReason = 'completed' | 'max_steps';

export interface AgentRunResult {
  compactionsUsed: number;
  finalText: string;
  inputItems: ResponseInputItem[];
  stepsUsed: number;
  stopReason: AgentStopReason;
}

export type AgentEvent =
  | { chunk: string; kind: 'reasoning-delta' }
  | { chunk: string; kind: 'text-delta' }
  | { kind: 'compaction-complete'; summary: string }
  | { kind: 'compaction-start' }
  | { call: ToolCall; kind: 'tool-call' }
  | { call: ToolCall; chunk: string; kind: 'tool-stderr' }
  | { call: ToolCall; chunk: string; kind: 'tool-stdout' }
  | { call: ToolCall; kind: 'tool-result'; result: ToolExecutionResult }
  | { kind: 'end'; result: AgentRunResult };
