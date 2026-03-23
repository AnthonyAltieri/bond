import type { PlanSnapshot, PlanStep, PlanStepStatus } from '@bond/tool-plan';
import type { ToolCall, ToolDefinition, ToolExecutionResult } from '@bond/tool-runtime';

export type { PlanSnapshot, PlanStep, PlanStepStatus } from '@bond/tool-plan';
export type {
  JsonSchema,
  Tool,
  ToolCall,
  ToolDefinition,
  ToolEvent,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@bond/tool-runtime';

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
  plan?: PlanSnapshot;
  stepsUsed: number;
  stopReason: AgentStopReason;
}

export type AgentEvent =
  | { chunk: string; kind: 'reasoning-delta' }
  | { chunk: string; kind: 'text-delta' }
  | { kind: 'compaction-complete'; summary: string }
  | { kind: 'compaction-start' }
  | { kind: 'plan-update'; plan: PlanSnapshot }
  | { call: ToolCall; kind: 'tool-call' }
  | { call: ToolCall; chunk: string; kind: 'tool-stderr' }
  | { call: ToolCall; chunk: string; kind: 'tool-stdout' }
  | { call: ToolCall; kind: 'tool-result'; result: ToolExecutionResult }
  | { kind: 'end'; result: AgentRunResult };
