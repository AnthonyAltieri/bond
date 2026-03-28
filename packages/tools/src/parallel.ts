import type { Tool } from './types.ts';
import { parseJsonObject } from './shared/json.ts';

const ALLOWED_PARALLEL_TOOLS = new Set([
  'functions.exec_command',
  'functions.list_mcp_resource_templates',
  'functions.list_mcp_resources',
  'functions.read_mcp_resource',
  'functions.update_plan',
  'functions.view_image',
  'multi_tool_use.parallel',
  'shell',
  'update_plan',
]);

export function createParallelTool(tools: Tool[]): Tool {
  const toolMap = new Map(tools.map((tool) => [tool.definition.name, tool]));

  return {
    definition: {
      description: 'Run multiple developer tools in parallel when it is safe to do so.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          tool_uses: {
            items: {
              additionalProperties: false,
              properties: { parameters: { type: 'object' }, recipient_name: { type: 'string' } },
              required: ['recipient_name', 'parameters'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['tool_uses'],
        type: 'object',
      },
      kind: 'function',
      name: 'multi_tool_use.parallel',
    },
    async execute(inputText, context) {
      const parsed = parseJsonObject(inputText, 'multi_tool_use.parallel');
      const toolUses = parsed.tool_uses;

      if (!Array.isArray(toolUses) || toolUses.length === 0) {
        throw new Error('multi_tool_use.parallel requires a non-empty "tool_uses" array');
      }

      const tasks = toolUses.map((entry, index) => parseParallelToolUse(entry, index, toolMap));
      const results = await Promise.all(
        tasks.map(async (task, index) => {
          const result = await task.tool.execute(JSON.stringify(task.parameters), {
            ...context,
            callId: `${context.callId}:${String(index)}`,
          });

          return {
            content: result.content,
            name: task.tool.definition.name,
            summary: result.summary,
          };
        }),
      );

      return {
        content: JSON.stringify({ results }, null, 2),
        metadata: { results },
        name: 'multi_tool_use.parallel',
        summary: `results=${String(results.length)}`,
      };
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

function parseParallelToolUse(
  value: unknown,
  index: number,
  toolMap: Map<string, Tool>,
): { parameters: Record<string, unknown>; tool: Tool } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`tool_uses[${String(index)}] must be an object`);
  }

  const recipientName = Reflect.get(value, 'recipient_name');
  const parameters = Reflect.get(value, 'parameters');

  if (typeof recipientName !== 'string' || !recipientName) {
    throw new Error(`tool_uses[${String(index)}].recipient_name must be a non-empty string`);
  }

  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error(`tool_uses[${String(index)}].parameters must be an object`);
  }

  const tool = toolMap.get(recipientName);

  if (!tool) {
    throw new Error(`Unknown tool "${recipientName}"`);
  }

  if (tool.definition.kind !== 'function') {
    throw new Error(`${recipientName} is not a function tool and cannot be parallelized`);
  }

  if (!ALLOWED_PARALLEL_TOOLS.has(recipientName)) {
    throw new Error(`${recipientName} is not allowed through multi_tool_use.parallel`);
  }

  return { parameters: parameters as Record<string, unknown>, tool };
}
