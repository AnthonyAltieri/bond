export interface ExecCommandRequest {
  cmd: string;
  login?: boolean;
  maxOutputTokens?: number;
  shell?: string;
  tty?: boolean;
  workdir?: string;
  yieldTimeMs?: number;
}

export interface ExecCommandResponse {
  chunkId?: string;
  exitCode?: number;
  originalTokenCount?: number;
  output: string;
  sessionId?: number;
  wallTimeSeconds: number;
}

export interface WriteStdinRequest {
  chars?: string;
  maxOutputTokens?: number;
  sessionId: number;
  yieldTimeMs?: number;
}

export interface ExecSessionManager {
  execCommand(request: ExecCommandRequest): Promise<ExecCommandResponse>;
  writeStdin(request: WriteStdinRequest): Promise<ExecCommandResponse>;
}

export interface McpResource {
  [key: string]: unknown;
  server: string;
  uri: string;
}

export interface McpResourceTemplate {
  [key: string]: unknown;
  server: string;
  uriTemplate: string;
}

export interface McpResourceContents {
  [key: string]: unknown;
}

export interface McpListResourcesResult {
  nextCursor?: string | null;
  resources: McpResource[];
  server?: string;
}

export interface McpListResourceTemplatesResult {
  nextCursor?: string | null;
  resourceTemplates: McpResourceTemplate[];
  server?: string;
}

export interface McpReadResourceResult extends McpResourceContents {
  server: string;
  uri: string;
}

export interface McpResourceRegistry {
  listResourceTemplates(options?: {
    cursor?: string;
    server?: string;
  }): Promise<McpListResourceTemplatesResult>;
  listResources(options?: { cursor?: string; server?: string }): Promise<McpListResourcesResult>;
  readResource(options: { server: string; uri: string }): Promise<McpReadResourceResult>;
}

export interface AgentInputItem {
  image_url?: string;
  name?: string;
  path?: string;
  text?: string;
  type?: 'image' | 'local_image' | 'mention' | 'skill' | 'text';
}

export interface SpawnAgentRequest {
  agent_type?: string;
  fork_context?: boolean;
  items?: AgentInputItem[];
  message?: string;
  model?: string;
  reasoning_effort?: string;
  task_name?: string;
}

export interface SpawnAgentResult {
  agentId: string | null;
  nickname: string | null;
  taskName: string | null;
}

export interface SendAgentInputRequest {
  interrupt?: boolean;
  items?: AgentInputItem[];
  message?: string;
  target: string;
}

export interface SendAgentInputResult {
  submissionId: string;
}

export type AgentStatus =
  | 'not_found'
  | 'pending_init'
  | 'running'
  | 'shutdown'
  | { completed: string | null }
  | { errored: string };

export interface ResumeAgentResult {
  status: AgentStatus;
}

export interface WaitAgentResult {
  status: Record<string, AgentStatus>;
  timedOut: boolean;
}

export interface CloseAgentResult {
  previousStatus: AgentStatus;
}

export interface AgentManager {
  closeAgent(target: string): Promise<CloseAgentResult>;
  resumeAgent(id: string): Promise<ResumeAgentResult>;
  sendInput(request: SendAgentInputRequest): Promise<SendAgentInputResult>;
  spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResult>;
  waitForAgents(options: { targets: string[]; timeoutMs?: number }): Promise<WaitAgentResult>;
}

export interface ToolServices {
  agentManager: AgentManager;
  execSessions: ExecSessionManager;
  mcpRegistry: McpResourceRegistry;
}

class UnavailableExecSessionManager implements ExecSessionManager {
  async execCommand(): Promise<ExecCommandResponse> {
    throw new Error('functions.exec_command is unavailable in this session');
  }

  async writeStdin(): Promise<ExecCommandResponse> {
    throw new Error('functions.write_stdin is unavailable in this session');
  }
}

class EmptyMcpResourceRegistry implements McpResourceRegistry {
  async listResourceTemplates(
    options: { cursor?: string; server?: string } = {},
  ): Promise<McpListResourceTemplatesResult> {
    return { nextCursor: null, resourceTemplates: [], server: options.server };
  }

  async listResources(
    options: { cursor?: string; server?: string } = {},
  ): Promise<McpListResourcesResult> {
    return { nextCursor: null, resources: [], server: options.server };
  }

  async readResource(options: { server: string; uri: string }): Promise<McpReadResourceResult> {
    throw new Error(
      `No MCP resource registry is configured for server "${options.server}" and uri "${options.uri}"`,
    );
  }
}

class UnavailableAgentManager implements AgentManager {
  async closeAgent(): Promise<CloseAgentResult> {
    return { previousStatus: 'not_found' };
  }

  async resumeAgent(): Promise<ResumeAgentResult> {
    return { status: 'not_found' };
  }

  async sendInput(): Promise<SendAgentInputResult> {
    throw new Error('Agent delegation is unavailable in this session');
  }

  async spawnAgent(): Promise<SpawnAgentResult> {
    throw new Error('Agent delegation is unavailable in this session');
  }

  async waitForAgents(): Promise<WaitAgentResult> {
    return { status: {}, timedOut: true };
  }
}

export function createDefaultToolServices(overrides: Partial<ToolServices> = {}): ToolServices {
  return {
    agentManager: overrides.agentManager ?? new UnavailableAgentManager(),
    execSessions: overrides.execSessions ?? new UnavailableExecSessionManager(),
    mcpRegistry: overrides.mcpRegistry ?? new EmptyMcpResourceRegistry(),
  };
}
