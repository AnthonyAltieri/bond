import { describe, expect, test } from 'bun:test';

import {
  createDefaultToolServices,
  createListMcpResourcesTool,
  createReadMcpResourceTool,
} from '@bond/tools';

describe('MCP tools', () => {
  const services = createDefaultToolServices();
  const baseContext = {
    callId: 'call_mcp',
    cwd: process.cwd(),
    defaultTimeoutMs: 250,
    services,
    shell: '/bin/sh',
    workspaceRoot: process.cwd(),
  } as const;

  test('lists empty MCP resources by default', async () => {
    const tool = createListMcpResourcesTool(services);
    const result = await tool.execute('{}', baseContext);

    expect(result.content).toContain('"resources": []');
  });

  test('fails clearly when reading from an unconfigured MCP registry', async () => {
    const tool = createReadMcpResourceTool(services);

    await expect(
      tool.execute('{"server":"demo","uri":"resource://x"}', baseContext),
    ).rejects.toThrow('No MCP resource registry is configured');
  });
});
