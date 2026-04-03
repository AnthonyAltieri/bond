import type { ToolServices } from './services.ts';

export interface ToolCall {
  id: string;
  inputText: string;
  kind: 'custom' | 'function';
  name: string;
}

export interface JsonSchema {
  [key: string]: JsonSchemaValue;
}

export type JsonSchemaValue = JsonSchema | JsonSchemaValue[] | boolean | null | number | string;

export interface ToolInputTextContentItem {
  text: string;
  type: 'input_text';
}

export interface ToolOutputTextContentItem {
  text: string;
  type: 'output_text';
}

export interface ToolSummaryTextContentItem {
  text: string;
  type: 'summary_text';
}

export interface ToolInputImageContentItem {
  detail?: string | null;
  image_url: string;
  type: 'input_image';
}

export type ToolOutputContentItem =
  | ToolInputImageContentItem
  | ToolInputTextContentItem
  | ToolOutputTextContentItem
  | ToolSummaryTextContentItem;

export type ToolCallOutput = string | ToolOutputContentItem[];

export interface ToolExecutionSessionSnapshot {
  conversationItems: unknown[];
  currentPlan?: unknown;
}

export interface ToolDefinitionBase {
  description: string;
  name: string;
}

export interface FunctionToolDefinition extends ToolDefinitionBase {
  inputSchema: JsonSchema;
  kind: 'function';
}

export interface CustomToolTextFormat {
  type: 'text';
}

export interface CustomToolGrammarFormat {
  definition: string;
  syntax: 'lark' | 'regex';
  type: 'grammar';
}

export type CustomToolFormat = CustomToolGrammarFormat | CustomToolTextFormat;

export interface CustomToolDefinition extends ToolDefinitionBase {
  format: CustomToolFormat;
  kind: 'custom';
}

export type ToolDefinition = CustomToolDefinition | FunctionToolDefinition;

export interface ToolExecutionContext {
  callId: string;
  cwd: string;
  defaultTimeoutMs: number;
  sessionSnapshot?: ToolExecutionSessionSnapshot;
  shell: string;
  services?: ToolServices;
  workspaceRoot: string;
}

export interface ToolExecutionResult {
  content: string;
  metadata?: object;
  name: string;
  output?: ToolCallOutput;
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
