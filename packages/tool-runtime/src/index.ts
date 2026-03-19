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
