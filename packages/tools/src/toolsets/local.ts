import { createPlanTool } from '../plan.ts';
import {
  createCloseAgentTool,
  createResumeAgentTool,
  createSendInputTool,
  createSpawnAgentTool,
  createWaitAgentTool,
} from '../agents.ts';
import { createApplyPatchTool } from '../apply-patch.ts';
import {
  createExecCommandTool,
  createInMemoryExecSessionManager,
  createWriteStdinTool,
} from '../exec.ts';
import {
  createListMcpResourceTemplatesTool,
  createListMcpResourcesTool,
  createReadMcpResourceTool,
} from '../mcp.ts';
import { createParallelTool } from '../parallel.ts';
import { createDefaultToolServices, type ToolServices } from '../services.ts';
import { createViewImageTool } from '../view-image.ts';
import type { Tool } from '../types.ts';
import { createShellTool } from '../shell.ts';

interface LocalToolsetOptions {
  services?: Partial<ToolServices>;
}

export function createLocalToolset(options: LocalToolsetOptions = {}): Tool[] {
  const services = createDefaultToolServices({
    agentManager: options.services?.agentManager,
    execSessions: options.services?.execSessions ?? createInMemoryExecSessionManager(),
    mcpRegistry: options.services?.mcpRegistry,
  });

  const tools: Tool[] = [
    createShellTool(),
    createPlanTool(),
    createPlanTool({ name: 'functions.update_plan' }),
    createExecCommandTool(services),
    createWriteStdinTool(services),
    createApplyPatchTool(),
    createViewImageTool(),
    createListMcpResourcesTool(services),
    createListMcpResourceTemplatesTool(services),
    createReadMcpResourceTool(services),
    createSpawnAgentTool(services),
    createSendInputTool(services),
    createResumeAgentTool(services),
    createWaitAgentTool(services),
    createCloseAgentTool(services),
  ];

  tools.push(createParallelTool(tools));

  return tools;
}
