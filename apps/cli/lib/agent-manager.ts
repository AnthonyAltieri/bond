import { randomUUID } from 'node:crypto';

import type { AgentRunResult } from '@bond/agent';
import type {
  AgentInputItem,
  AgentManager,
  AgentStatus,
  CloseAgentResult,
  ResumeAgentResult,
  SendAgentInputResult,
  SpawnAgentResult,
  WaitAgentResult,
} from '@bond/tools';

interface ManagedAgent {
  closed: boolean;
  id: string;
  lastResult?: AgentRunResult;
  lastStatus?: AgentStatus;
  nickname: string | null;
  pending: Array<{ prompt: string; submissionId: string }>;
  running: boolean;
  session: { run(prompt: string): Promise<AgentRunResult> };
  taskName: string | null;
}

interface InProcessAgentManagerOptions {
  createSession: (overrides: { model?: string; reasoningEffort?: string }) => {
    run(prompt: string): Promise<AgentRunResult>;
  };
}

export function createInProcessAgentManager(options: InProcessAgentManagerOptions): AgentManager {
  const agentsById = new Map<string, ManagedAgent>();
  const taskNames = new Map<string, string>();

  return {
    async closeAgent(target): Promise<CloseAgentResult> {
      const agent = resolveAgentTarget(target, agentsById, taskNames);
      const previousStatus = agent ? getAgentStatus(agent) : 'not_found';

      if (agent) {
        agent.closed = true;
        agent.pending = [];
      }

      return { previousStatus };
    },
    async resumeAgent(id): Promise<ResumeAgentResult> {
      const agent = agentsById.get(id);

      if (!agent) {
        return { status: 'not_found' };
      }

      agent.closed = false;

      if (!agent.running && agent.pending.length > 0) {
        void pumpAgent(agent);
      }

      return { status: getAgentStatus(agent) };
    },
    async sendInput(request): Promise<SendAgentInputResult> {
      const agent = resolveAgentTarget(request.target, agentsById, taskNames);

      if (!agent) {
        throw new Error(`Unknown agent target "${request.target}"`);
      }

      if (agent.closed) {
        throw new Error(`Agent "${request.target}" is closed`);
      }

      const prompt = buildPrompt(request.message, request.items);
      const submissionId = randomUUID();
      const entry = { prompt, submissionId };

      if (request.interrupt) {
        agent.pending.unshift(entry);
      } else {
        agent.pending.push(entry);
      }

      if (!agent.running) {
        void pumpAgent(agent);
      }

      return { submissionId };
    },
    async spawnAgent(request): Promise<SpawnAgentResult> {
      if (request.fork_context) {
        throw new Error('fork_context is not supported by Bond child agents yet');
      }

      if (request.task_name) {
        const existingId = taskNames.get(request.task_name);

        if (existingId) {
          throw new Error(`Agent task name "${request.task_name}" already exists`);
        }
      }

      const prompt = buildPrompt(request.message, request.items);
      const id = randomUUID();
      const taskName = request.task_name ?? null;
      const nickname = taskName ?? request.agent_type ?? null;
      const agent: ManagedAgent = {
        closed: false,
        id,
        nickname,
        pending: [{ prompt, submissionId: randomUUID() }],
        running: false,
        session: options.createSession({
          model: request.model,
          reasoningEffort: request.reasoning_effort,
        }),
        taskName,
      };
      agentsById.set(id, agent);

      if (taskName) {
        taskNames.set(taskName, id);
      }

      void pumpAgent(agent);

      return { agentId: id, nickname, taskName };
    },
    async waitForAgents(options): Promise<WaitAgentResult> {
      const timeoutMs = options.timeoutMs ?? 30_000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const statuses = collectFinalStatuses(options.targets, agentsById, taskNames);

        if (Object.keys(statuses).length > 0) {
          return { status: statuses, timedOut: false };
        }

        await sleep(50);
      }

      return { status: {}, timedOut: true };
    },
  };

  async function pumpAgent(agent: ManagedAgent): Promise<void> {
    if (agent.running || agent.closed) {
      return;
    }

    while (!agent.closed && agent.pending.length > 0) {
      const next = agent.pending.shift();

      if (!next) {
        return;
      }

      agent.running = true;
      agent.lastStatus = 'running';

      try {
        const result = await agent.session.run(next.prompt);
        agent.lastResult = result;
        agent.lastStatus = { completed: result.finalText || null };
      } catch (error) {
        agent.lastStatus = { errored: toErrorMessage(error) };
      } finally {
        agent.running = false;
      }
    }

    if (!agent.closed && !agent.running && agent.lastStatus === undefined) {
      agent.lastStatus = 'pending_init';
    }
  }
}

function buildPrompt(message?: string, items?: AgentInputItem[]): string {
  const text = message?.trim();

  if (text) {
    return text;
  }

  if (!items || items.length === 0) {
    throw new Error('spawn_agent and send_input require either a message or items');
  }

  return items
    .map((item) => {
      switch (item.type) {
        case 'image':
          return `[image ${item.image_url ?? ''}]`.trim();
        case 'local_image':
          return `[local_image ${item.path ?? ''}]`.trim();
        case 'mention':
          return `[mention ${item.name ?? item.path ?? ''}]`.trim();
        case 'skill':
          return `[skill ${item.name ?? item.path ?? ''}]`.trim();
        case 'text':
        case undefined:
          return item.text ?? '';
      }
    })
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim();
}

function collectFinalStatuses(
  targets: string[],
  agentsById: Map<string, ManagedAgent>,
  taskNames: Map<string, string>,
): Record<string, AgentStatus> {
  const statuses: Record<string, AgentStatus> = {};

  for (const target of targets) {
    const agent = resolveAgentTarget(target, agentsById, taskNames);
    const status = agent ? getAgentStatus(agent) : 'not_found';

    if (isFinalStatus(status)) {
      statuses[target] = status;
    }
  }

  return statuses;
}

function getAgentStatus(agent: ManagedAgent): AgentStatus {
  if (agent.closed) {
    return 'shutdown';
  }

  if (agent.running) {
    return 'running';
  }

  return agent.lastStatus ?? 'pending_init';
}

function isFinalStatus(status: AgentStatus): boolean {
  return (
    status === 'not_found' ||
    status === 'shutdown' ||
    (typeof status === 'object' && status !== null)
  );
}

function resolveAgentTarget(
  target: string,
  agentsById: Map<string, ManagedAgent>,
  taskNames: Map<string, string>,
): ManagedAgent | undefined {
  const id = agentsById.has(target) ? target : taskNames.get(target);
  return id ? agentsById.get(id) : undefined;
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
