import type { PlanSnapshot } from './plan.ts';
import type { JsonSchema, Tool, ToolExecutionResult } from './types.ts';
import { createDefaultToolServices, type AgentInputItem, type ToolServices } from './services.ts';
import {
  getOptionalArray,
  getOptionalBoolean,
  getOptionalNumber,
  getOptionalString,
  parseJsonObject,
} from './shared/json.ts';

export function createSpawnAgentTool(fallbackServices?: Partial<ToolServices>): Tool {
  return {
    definition: {
      description:
        'Spawn a child agent for a narrow task, especially independent work that can run in parallel with the main thread. Use this when the user asks for subagents, delegation, or parallelized work.',
      inputSchema: createAgentInputSchema(true),
      kind: 'function',
      name: 'functions.spawn_agent',
    },
    async execute(inputText, context) {
      const input = parseJsonObject(inputText, 'functions.spawn_agent');
      const toolServices = mergeToolServices(context.services, fallbackServices);
      const result = await toolServices.agentManager.spawnAgent({
        agent_type: getOptionalString(input, 'agent_type'),
        fork_context: getOptionalBoolean(input, 'fork_context'),
        items: parseAgentItems(input),
        message: getOptionalString(input, 'message'),
        model: getOptionalString(input, 'model'),
        parent_context: context.sessionSnapshot
          ? {
              conversation_items: context.sessionSnapshot.conversationItems,
              current_plan: isPlanSnapshotLike(context.sessionSnapshot.currentPlan)
                ? context.sessionSnapshot.currentPlan
                : undefined,
            }
          : undefined,
        reasoning_effort: getOptionalString(input, 'reasoning_effort'),
        task_name: getOptionalString(input, 'task_name'),
      });

      return formatAgentToolResult(
        'functions.spawn_agent',
        { agent_id: result.agentId, nickname: result.nickname, task_name: result.taskName },
        result.agentId
          ? `agent=${result.agentId}${result.taskName ? ` task=${result.taskName}` : ''}`
          : 'agent=none',
      );
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

export function createSendInputTool(fallbackServices?: Partial<ToolServices>): Tool {
  return {
    definition: {
      description:
        'Send follow-up input to an existing child agent so you can refine or extend its task without spawning a duplicate.',
      inputSchema: createAgentInputSchema(false),
      kind: 'function',
      name: 'functions.send_input',
    },
    async execute(inputText, context) {
      const input = parseJsonObject(inputText, 'functions.send_input');
      const target = getOptionalString(input, 'target');

      if (!target) {
        throw new Error('input requires a non-empty "target" string');
      }

      const toolServices = mergeToolServices(context.services, fallbackServices);
      const result = await toolServices.agentManager.sendInput({
        interrupt: getOptionalBoolean(input, 'interrupt'),
        items: parseAgentItems(input),
        message: getOptionalString(input, 'message'),
        target,
      });

      return formatAgentToolResult(
        'functions.send_input',
        { submission_id: result.submissionId },
        `submission=${result.submissionId}`,
      );
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

export function createResumeAgentTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createSimpleAgentTool({
    description: 'Resume a previously closed child agent by id so it can accept more work.',
    name: 'functions.resume_agent',
    run: async (input, services) => {
      const id = getOptionalString(input, 'id');

      if (!id) {
        throw new Error('input requires a non-empty "id" string');
      }

      return formatAgentToolResult(
        'functions.resume_agent',
        await services.agentManager.resumeAgent(id),
        `agent=${id}`,
      );
    },
    fallbackServices,
  });
}

export function createWaitAgentTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createSimpleAgentTool({
    description:
      'Wait for child agents to reach a final status when the main thread is blocked on their result, so you can gather their exploration or implementation output back into the main thread.',
    name: 'functions.wait_agent',
    run: async (input, services) => {
      const targetsValue = getOptionalArray(input, 'targets');

      if (!targetsValue || targetsValue.length === 0) {
        throw new Error('input requires a non-empty "targets" array');
      }

      const targets = targetsValue.map((value, index) => {
        if (typeof value !== 'string' || !value) {
          throw new Error(`input targets[${String(index)}] must be a non-empty string`);
        }

        return value;
      });

      return formatAgentToolResult(
        'functions.wait_agent',
        await services.agentManager.waitForAgents({
          targets,
          timeoutMs: getOptionalNumber(input, 'timeout_ms'),
        }),
        `targets=${targets.length}`,
      );
    },
    fallbackServices,
  });
}

export function createCloseAgentTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createSimpleAgentTool({
    description: 'Close a child agent that is no longer needed and return its previous status.',
    name: 'functions.close_agent',
    run: async (input, services) => {
      const target = getOptionalString(input, 'target');

      if (!target) {
        throw new Error('input requires a non-empty "target" string');
      }

      return formatAgentToolResult(
        'functions.close_agent',
        await services.agentManager.closeAgent(target),
        `agent=${target}`,
      );
    },
    fallbackServices,
  });
}

function createAgentInputSchema(includeSpawnFields: boolean): JsonSchema {
  const properties: JsonSchema = {
    interrupt: { type: 'boolean' },
    items: {
      items: {
        additionalProperties: false,
        properties: {
          image_url: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
          text: { type: 'string' },
          type: { type: 'string' },
        },
        type: 'object',
      },
      type: 'array',
    },
    message: { type: 'string' },
    target: { type: 'string' },
  };

  if (includeSpawnFields) {
    properties.agent_type = { type: 'string' };
    properties.fork_context = { type: 'boolean' };
    properties.model = { type: 'string' };
    properties.reasoning_effort = { type: 'string' };
    properties.task_name = { type: 'string' };
  }

  return { additionalProperties: false, properties, type: 'object' };
}

function createSimpleAgentTool(options: {
  description: string;
  name: string;
  run: (input: Record<string, unknown>, services: ToolServices) => Promise<ToolExecutionResult>;
  fallbackServices?: Partial<ToolServices>;
}): Tool {
  return {
    definition: {
      description: options.description,
      inputSchema: {
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          target: { type: 'string' },
          targets: { items: { type: 'string' }, type: 'array' },
          timeout_ms: { type: 'number' },
        },
        type: 'object',
      },
      kind: 'function',
      name: options.name,
    },
    async execute(inputText, context) {
      return await options.run(
        parseJsonObject(inputText, options.name),
        mergeToolServices(context.services, options.fallbackServices),
      );
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

function mergeToolServices(
  contextServices: Partial<ToolServices> | undefined,
  fallbackServices: Partial<ToolServices> | undefined,
): ToolServices {
  return { ...createDefaultToolServices(fallbackServices), ...contextServices };
}

function formatAgentToolResult(name: string, value: unknown, summary = name): ToolExecutionResult {
  return {
    content: JSON.stringify(value, null, 2),
    metadata: value && typeof value === 'object' && !Array.isArray(value) ? value : undefined,
    name,
    summary,
  };
}

function parseAgentItems(source: Record<string, unknown>): AgentInputItem[] | undefined {
  const values = getOptionalArray(source, 'items');

  if (!values) {
    return undefined;
  }

  return values.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`input items[${String(index)}] must be an object`);
    }

    const item = value as Record<string, unknown>;
    const type = getOptionalString(item, 'type');

    if (
      type !== undefined &&
      type !== 'image' &&
      type !== 'local_image' &&
      type !== 'mention' &&
      type !== 'skill' &&
      type !== 'text'
    ) {
      throw new Error(`input items[${String(index)}].type is not supported: ${type}`);
    }

    return {
      image_url: getOptionalString(item, 'image_url'),
      name: getOptionalString(item, 'name'),
      path: getOptionalString(item, 'path'),
      text: getOptionalString(item, 'text'),
      type,
    };
  });
}

function isPlanSnapshotLike(value: unknown): value is PlanSnapshot {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(Reflect.get(value, 'steps')) &&
    (Reflect.get(value, 'explanation') === undefined ||
      typeof Reflect.get(value, 'explanation') === 'string') &&
    (Reflect.get(value, 'steps') as unknown[]).every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof Reflect.get(entry, 'step') === 'string' &&
        (Reflect.get(entry, 'status') === 'pending' ||
          Reflect.get(entry, 'status') === 'in_progress' ||
          Reflect.get(entry, 'status') === 'completed'),
    )
  );
}
