import { describe, expect, test } from 'bun:test';

import {
  createDefaultToolServices,
  createInMemoryExecSessionManager,
  createLocalToolset,
} from '@bond/tools';

describe('createParallelTool', () => {
  const services = createDefaultToolServices({ execSessions: createInMemoryExecSessionManager() });
  const baseContext = {
    callId: 'call_parallel',
    cwd: process.cwd(),
    defaultTimeoutMs: 250,
    services,
    shell: '/bin/sh',
    workspaceRoot: process.cwd(),
  } as const;

  test('runs safe tools in parallel', async () => {
    const tool = createLocalToolset({ services }).find(
      (entry) => entry.definition.name === 'multi_tool_use.parallel',
    );

    if (!tool) {
      throw new Error('parallel tool not found');
    }

    const result = await tool.execute(
      JSON.stringify({
        tool_uses: [
          {
            parameters: { plan: [{ status: 'in_progress', step: 'One' }] },
            recipient_name: 'functions.update_plan',
          },
          { parameters: {}, recipient_name: 'functions.list_mcp_resources' },
        ],
      }),
      baseContext,
    );

    expect(result.content).toContain('"name": "functions.update_plan"');
    expect(result.content).toContain('"name": "functions.list_mcp_resources"');
  });

  test('rejects tools outside the allowlist', async () => {
    const tool = createLocalToolset({ services }).find(
      (entry) => entry.definition.name === 'multi_tool_use.parallel',
    );

    if (!tool) {
      throw new Error('parallel tool not found');
    }

    await expect(
      tool.execute(
        JSON.stringify({
          tool_uses: [{ parameters: { session_id: 1 }, recipient_name: 'functions.write_stdin' }],
        }),
        baseContext,
      ),
    ).rejects.toThrow('functions.write_stdin is not allowed');
  });
});
