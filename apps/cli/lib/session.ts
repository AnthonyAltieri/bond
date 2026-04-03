import {
  AgentSession,
  OpenAIResponsesClient,
  type AgentEvent,
  type AgentRunResult,
} from '@bond/agent';
import {
  createDefaultToolServices,
  createInMemoryExecSessionManager,
  createLocalToolset,
  type ToolServices,
} from '@bond/tools';

import { createCliConfig, type CliConfig } from './config/config.ts';
import type { CliArgs } from './config/args.ts';
import { createInProcessAgentManager } from './agent-manager.ts';

export interface AgentSessionLike {
  stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult>;
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
  let toolServices: ToolServices;

  const buildChildSession = (overrides: {
    model?: string;
    reasoningEffort?: string;
  }): AgentSession =>
    new AgentSession({
      autoCompactTokenLimit: config.autoCompactTokenLimit,
      client,
      commandTimeoutMs: config.commandTimeoutMs,
      compactionModel: config.compactionModel,
      cwd: config.cwd,
      maxSteps: config.maxSteps,
      model: overrides.model ?? config.model,
      shell: config.shell,
      toolServices,
      tools: createLocalToolset({ services: toolServices }),
    });

  toolServices = createDefaultToolServices({
    agentManager: createInProcessAgentManager({ createSession: buildChildSession }),
    execSessions: createInMemoryExecSessionManager(),
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
    toolServices,
    tools: createLocalToolset({ services: toolServices }),
  });
}
