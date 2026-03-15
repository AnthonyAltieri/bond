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

export interface Tool {
  definition: ToolDefinition;
  execute(inputText: string, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ModelTurnParams {
  messages: Message[];
  model: string;
  onTextDelta?: (chunk: string) => void;
  tools: ToolDefinition[];
}

export type ModelStopReason = 'length' | 'stop' | 'tool_calls';

export interface ModelTurnResult {
  stopReason: ModelStopReason;
  text: string;
  toolCalls: ToolCall[];
}

export interface ModelClient {
  runTurn(params: ModelTurnParams): Promise<ModelTurnResult>;
}

export interface AgentHooks {
  onTextDelta?: (chunk: string) => void;
  onToolResult?: (call: ToolCall, result: ToolExecutionResult) => void;
  onToolStart?: (call: ToolCall) => void;
}

export type AgentStopReason = 'completed' | 'max_steps';

export interface AgentRunResult {
  finalText: string;
  messages: Message[];
  stepsUsed: number;
  stopReason: AgentStopReason;
}
