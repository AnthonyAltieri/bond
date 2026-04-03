import { randomUUID } from 'node:crypto';

import type { AgentRunResult, ResponseContentPart, ResponseMessageItem } from '@bond/agent';
import type {
  AgentCompletion,
  AgentInputItem,
  AgentManager,
  AgentParentContext,
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
  pending: Array<{ input: PendingAgentInput; submissionId: string }>;
  running: boolean;
  session: {
    run(prompt: string): Promise<AgentRunResult>;
    runMessage?(message: ResponseMessageItem): Promise<AgentRunResult>;
  };
  taskName: string | null;
}

interface InProcessAgentManagerOptions {
  createSession: (overrides: {
    model?: string;
    reasoningEffort?: string;
    seed?: AgentParentContext;
  }) => {
    run(prompt: string): Promise<AgentRunResult>;
    runMessage?(message: ResponseMessageItem): Promise<AgentRunResult>;
  };
}

type PendingAgentInput =
  | { kind: 'message'; message: ResponseMessageItem }
  | { kind: 'prompt'; prompt: string };

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

      const submissionId = randomUUID();
      const entry = { input: buildPendingInput(request.message, request.items), submissionId };

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
      if (request.task_name) {
        const existingId = taskNames.get(request.task_name);

        if (existingId) {
          throw new Error(`Agent task name "${request.task_name}" already exists`);
        }
      }

      const id = randomUUID();
      const taskName = request.task_name ?? null;
      const nickname = taskName ?? request.agent_type ?? null;
      const agent: ManagedAgent = {
        closed: false,
        id,
        nickname,
        pending: [
          { input: buildPendingInput(request.message, request.items), submissionId: randomUUID() },
        ],
        running: false,
        session: options.createSession({
          model: request.model,
          reasoningEffort: request.reasoning_effort,
          seed: request.fork_context ? request.parent_context : undefined,
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
        const result =
          next.input.kind === 'message' && agent.session.runMessage
            ? await agent.session.runMessage(next.input.message)
            : await agent.session.run(
                next.input.kind === 'prompt'
                  ? next.input.prompt
                  : flattenMessageToPrompt(next.input.message),
              );
        agent.lastResult = result;
        agent.lastStatus = { completed: toAgentCompletion(result) };
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

function buildPendingInput(message?: string, items?: AgentInputItem[]): PendingAgentInput {
  return hasStructuredItems(items)
    ? { kind: 'message', message: buildUserMessage(message, items) }
    : { kind: 'prompt', prompt: buildPrompt(message, items) };
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

function buildUserMessage(message?: string, items?: AgentInputItem[]): ResponseMessageItem {
  const content: ResponseContentPart[] = [];
  const text = message?.trim();

  if (text) {
    content.push({ text, type: 'input_text' });
  }

  for (const item of items ?? []) {
    switch (item.type) {
      case 'image':
        if (!item.image_url) {
          break;
        }
        content.push({ image_url: item.image_url, type: 'input_image' });
        break;
      case 'local_image':
        content.push({ text: `[local_image ${item.path ?? ''}]`.trim(), type: 'input_text' });
        break;
      case 'mention':
        content.push({
          text: `[mention ${item.name ?? item.path ?? ''}]`.trim(),
          type: 'input_text',
        });
        break;
      case 'skill':
        content.push({
          text: `[skill ${item.name ?? item.path ?? ''}]`.trim(),
          type: 'input_text',
        });
        break;
      case 'text':
      case undefined:
        if (item.text?.trim()) {
          content.push({ text: item.text, type: 'input_text' });
        }
        break;
    }
  }

  if (content.length === 0) {
    throw new Error('spawn_agent and send_input require either a message or items');
  }

  return { content, role: 'user', type: 'message' };
}

function hasStructuredItems(items?: AgentInputItem[]): boolean {
  return (items ?? []).some((item) => item.type === 'image');
}

function flattenMessageToPrompt(message: ResponseMessageItem): string {
  return message.content
    .map((part) => {
      if (
        part.type === 'input_text' ||
        part.type === 'output_text' ||
        part.type === 'summary_text'
      ) {
        return part.text;
      }

      return `[image ${part.image_url}]`;
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

function toAgentCompletion(result: AgentRunResult): AgentCompletion {
  return {
    final_text: result.finalText || null,
    plan: result.plan,
    stop_reason: result.stopReason,
    steps_used: result.stepsUsed,
    tool_usage: summarizeToolUsage(result),
  };
}

function summarizeToolUsage(result: AgentRunResult): AgentCompletion['tool_usage'] {
  const callCounts = result.inputItems.reduce<Record<string, number>>((counts, item) => {
    if (item.type !== 'function_call' && item.type !== 'custom_tool_call') {
      return counts;
    }

    counts[item.name] = (counts[item.name] ?? 0) + 1;
    return counts;
  }, {});

  return {
    call_counts: callCounts,
    used_tools: Object.keys(callCounts).sort((left, right) => left.localeCompare(right)),
  };
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
