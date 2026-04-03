import type { Tool, ToolExecutionResult } from './types.ts';
import { createDefaultToolServices, type ToolServices } from './services.ts';
import { getOptionalString, parseJsonObject } from './shared/json.ts';

export function createListMcpResourcesTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createMcpTool({
    description:
      'Lists resources provided by MCP servers. Prefer resources over web search when possible.',
    name: 'functions.list_mcp_resources',
    run: async (input, services) => {
      const result = await services.mcpRegistry.listResources({
        cursor: getOptionalString(input, 'cursor'),
        server: getOptionalString(input, 'server'),
      });

      return {
        content: JSON.stringify(
          {
            nextCursor: result.nextCursor ?? null,
            resources: result.resources,
            server: result.server ?? null,
          },
          null,
          2,
        ),
        metadata: {
          nextCursor: result.nextCursor ?? null,
          resources: result.resources,
          server: result.server ?? null,
        },
        name: 'functions.list_mcp_resources',
        summary: `resources=${String(result.resources.length)}`,
      };
    },
    fallbackServices,
  });
}

export function createListMcpResourceTemplatesTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createMcpTool({
    description:
      'Lists resource templates provided by MCP servers. Prefer templates over web search when possible.',
    name: 'functions.list_mcp_resource_templates',
    run: async (input, services) => {
      const result = await services.mcpRegistry.listResourceTemplates({
        cursor: getOptionalString(input, 'cursor'),
        server: getOptionalString(input, 'server'),
      });

      return {
        content: JSON.stringify(
          {
            nextCursor: result.nextCursor ?? null,
            resourceTemplates: result.resourceTemplates,
            server: result.server ?? null,
          },
          null,
          2,
        ),
        metadata: {
          nextCursor: result.nextCursor ?? null,
          resourceTemplates: result.resourceTemplates,
          server: result.server ?? null,
        },
        name: 'functions.list_mcp_resource_templates',
        summary: `templates=${String(result.resourceTemplates.length)}`,
      };
    },
    fallbackServices,
  });
}

export function createReadMcpResourceTool(fallbackServices?: Partial<ToolServices>): Tool {
  return createMcpTool({
    description: 'Read a specific resource from an MCP server.',
    name: 'functions.read_mcp_resource',
    run: async (input, services) => {
      const server = getOptionalString(input, 'server');
      const uri = getOptionalString(input, 'uri');

      if (!server || !uri) {
        throw new Error('input requires non-empty "server" and "uri" strings');
      }

      const result = await services.mcpRegistry.readResource({ server, uri });

      return {
        content: JSON.stringify(result, null, 2),
        metadata: result,
        name: 'functions.read_mcp_resource',
        summary: `${server} ${uri}`,
      };
    },
    fallbackServices,
  });
}

function createMcpTool(options: {
  description: string;
  name: string;
  run: (
    input: Record<string, unknown>,
    services: ReturnType<typeof createDefaultToolServices>,
  ) => Promise<ToolExecutionResult>;
  fallbackServices?: Partial<ToolServices>;
}): Tool {
  return {
    definition: {
      description: options.description,
      inputSchema: {
        additionalProperties: false,
        properties: {
          cursor: { type: 'string' },
          server: { type: 'string' },
          uri: { type: 'string' },
        },
        type: 'object',
      },
      kind: 'function',
      name: options.name,
    },
    async execute(inputText, context) {
      return await options.run(parseJsonObject(inputText, options.name), {
        ...createDefaultToolServices(options.fallbackServices),
        ...context.services,
      });
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}
