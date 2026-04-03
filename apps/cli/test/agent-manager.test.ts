import { describe, expect, test } from 'bun:test';

import { createInProcessAgentManager } from '../lib/agent-manager.ts';

describe('createInProcessAgentManager', () => {
  test('spawns agents and waits for completion', async () => {
    const prompts: string[] = [];
    const manager = createInProcessAgentManager({
      createSession() {
        return {
          async run(prompt: string) {
            prompts.push(prompt);
            return {
              compactionsUsed: 0,
              finalText: `done:${prompt}`,
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed' as const,
            };
          },
        };
      },
    });

    const spawned = await manager.spawnAgent({ message: 'child task' });
    const waited = await manager.waitForAgents({
      targets: [spawned.agentId ?? 'missing'],
      timeoutMs: 1_000,
    });

    expect(prompts).toEqual(['child task']);
    expect(waited.timedOut).toBe(false);
    expect(waited.status[spawned.agentId ?? 'missing']).toEqual({ completed: 'done:child task' });
  });

  test('queues additional input for an existing agent', async () => {
    const prompts: string[] = [];
    const manager = createInProcessAgentManager({
      createSession() {
        return {
          async run(prompt: string) {
            prompts.push(prompt);
            return {
              compactionsUsed: 0,
              finalText: prompt,
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed' as const,
            };
          },
        };
      },
    });

    const spawned = await manager.spawnAgent({ message: 'first' });
    await manager.waitForAgents({ targets: [spawned.agentId ?? 'missing'], timeoutMs: 1_000 });
    await manager.sendInput({ message: 'second', target: spawned.agentId ?? 'missing' });
    const waited = await manager.waitForAgents({
      targets: [spawned.agentId ?? 'missing'],
      timeoutMs: 1_000,
    });

    expect(prompts).toEqual(['first', 'second']);
    expect(waited.status[spawned.agentId ?? 'missing']).toEqual({ completed: 'second' });
  });
});
