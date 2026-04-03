import {
  AgentSession,
  OpenAIResponsesClient,
  type AgentEvent,
  type AgentRunResult,
  type ResponseInputItem,
  type ResponseMessageItem,
} from '@bond/agent';
import {
  type AgentParentContext,
  createDefaultToolServices,
  createInMemoryExecSessionManager,
  createLocalToolset,
  type ToolServices,
  type Tool,
} from '@bond/tools';

import { createCliConfig, type CliConfig } from './config/config.ts';
import type { CliArgs } from './config/args.ts';
import { createInProcessAgentManager } from './agent-manager.ts';

export interface AgentSessionLike {
  stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult>;
}

export interface ChildAgentSessionLike {
  run(prompt: string): Promise<AgentRunResult>;
  runMessage?(message: ResponseMessageItem): Promise<AgentRunResult>;
}

export interface SessionFactoryOptions {
  autoCompactTokenLimit?: number;
  commandTimeoutMs?: number;
  compactionModel?: string;
  cwd: string;
  env: Record<string, string | undefined>;
  maxSteps?: number;
  model?: string;
}

export interface ToolEnvironmentOptions {
  autoCompactTokenLimit?: number;
  client: OpenAIResponsesClient;
  commandTimeoutMs?: number;
  compactionModel?: string;
  cwd: string;
  maxSteps?: number;
  model: string;
  shell: string;
}

export function createSession(
  args: CliArgs,
  runtimeEnv: Record<string, string | undefined>,
  cwd: string,
  factory?: (options: SessionFactoryOptions) => AgentSessionLike,
): AgentSessionLike {
  if (factory) {
    return factory({
      autoCompactTokenLimit: args.autoCompactTokens,
      commandTimeoutMs: args.timeoutMs,
      compactionModel: args.compactionModel,
      cwd,
      env: runtimeEnv,
      maxSteps: args.maxSteps,
      model: args.model,
    });
  }

  return createDefaultSession(createCliConfig(args, runtimeEnv, cwd));
}

function createDefaultSession(config: CliConfig): AgentSessionLike {
  const client = new OpenAIResponsesClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const environment = createToolEnvironment({
    autoCompactTokenLimit: config.autoCompactTokenLimit,
    client,
    commandTimeoutMs: config.commandTimeoutMs,
    compactionModel: config.compactionModel,
    cwd: config.cwd,
    maxSteps: config.maxSteps,
    model: config.model,
    shell: config.shell,
  });

  return new AgentSession({
    autoCompactTokenLimit: config.autoCompactTokenLimit,
    client,
    commandTimeoutMs: config.commandTimeoutMs,
    compactionModel: config.compactionModel,
    cwd: config.cwd,
    maxSteps: config.maxSteps,
    model: config.model,
    shell: config.shell,
    toolServices: environment.toolServices,
    tools: environment.tools,
  });
}

export function createToolEnvironment(options: ToolEnvironmentOptions): {
  toolServices: ToolServices;
  tools: Tool[];
} {
  let toolServices: ToolServices;

  const buildChildSession = (overrides: {
    model?: string;
    reasoningEffort?: string;
    seed?: AgentParentContext;
  }): ChildAgentSessionLike =>
    new AgentSession({
      autoCompactTokenLimit: options.autoCompactTokenLimit,
      client: options.client,
      commandTimeoutMs: options.commandTimeoutMs,
      compactionModel: options.compactionModel,
      cwd: options.cwd,
      initialConversationItems: cloneSeedConversationItems(overrides.seed),
      initialPlan: overrides.seed?.current_plan,
      maxSteps: options.maxSteps,
      model: overrides.model ?? options.model,
      reasoningEffort: overrides.reasoningEffort,
      shell: options.shell,
      toolServices,
      tools: createLocalToolset({ services: toolServices }),
    });

  toolServices = createDefaultToolServices({
    agentManager: createInProcessAgentManager({ createSession: buildChildSession }),
    execSessions: createInMemoryExecSessionManager(),
  });

  return { toolServices, tools: createLocalToolset({ services: toolServices }) };
}

function cloneSeedConversationItems(
  seed: AgentParentContext | undefined,
): ResponseInputItem[] | undefined {
  if (!seed?.conversation_items || !Array.isArray(seed.conversation_items)) {
    return undefined;
  }

  return structuredClone(seed.conversation_items) as ResponseInputItem[];
}
