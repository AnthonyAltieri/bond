import { describe, expect, test } from 'bun:test';

import {
  createDefaultToolServices,
  createInMemoryExecSessionManager,
  createLocalToolset,
} from '@bond/tools';

describe('createParallelTool', () => {
  const services = createDefaultToolServices({
    agentManager: {
      async closeAgent(_target) {
        return { previousStatus: 'shutdown' };
      },
      async resumeAgent(_id) {
        return { status: 'pending_init' };
      },
      async sendInput(_request) {
        return { submissionId: 'submission-1' };
      },
      async spawnAgent(request) {
        return { agentId: 'agent-1', nickname: request.agent_type ?? null, taskName: null };
      },
      async waitForAgents(_options) {
        return { status: {}, timedOut: true };
      },
    },
    execSessions: createInMemoryExecSessionManager(),
  });
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

  test('allows spawning child agents through the parallel wrapper', async () => {
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
            parameters: { agent_type: 'worker', message: 'inspect the codebase' },
            recipient_name: 'functions.spawn_agent',
          },
        ],
      }),
      baseContext,
    );
    const parsed = JSON.parse(result.content) as {
      results: Array<{ content: string; name: string; summary: string }>;
    };

    expect(parsed.results[0]?.name).toBe('functions.spawn_agent');
    expect(parsed.results[0]?.content).toContain('"agent_id": "agent-1"');
  });

  test('keeps wait_agent disallowed through the parallel wrapper', async () => {
    const tool = createLocalToolset({ services }).find(
      (entry) => entry.definition.name === 'multi_tool_use.parallel',
    );

    if (!tool) {
      throw new Error('parallel tool not found');
    }

    await expect(
      tool.execute(
        JSON.stringify({
          tool_uses: [
            { parameters: { targets: ['agent-1'] }, recipient_name: 'functions.wait_agent' },
          ],
        }),
        baseContext,
      ),
    ).rejects.toThrow('functions.wait_agent is not allowed');
  });
});
