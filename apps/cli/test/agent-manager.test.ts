import { describe, expect, test } from 'bun:test';
import type { ResponseMessageItem } from '@bond/agent';

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
              toolTrace: [],
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
    expect(waited.status[spawned.agentId ?? 'missing']).toEqual({
      completed: {
        final_text: 'done:child task',
        plan: undefined,
        steps_used: 1,
        stop_reason: 'completed',
        tool_usage: { call_counts: {}, used_tools: [] },
      },
    });
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
              toolTrace: [],
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
    expect(waited.status[spawned.agentId ?? 'missing']).toEqual({
      completed: {
        final_text: 'second',
        plan: undefined,
        steps_used: 1,
        stop_reason: 'completed',
        tool_usage: { call_counts: {}, used_tools: [] },
      },
    });
  });

  test('passes forked parent context into the child session seed', async () => {
    const seeds: Array<{ current_plan?: unknown; conversation_items: unknown[] } | undefined> = [];
    const manager = createInProcessAgentManager({
      createSession(overrides) {
        seeds.push(overrides.seed);
        return {
          async run(prompt: string) {
            return {
              compactionsUsed: 0,
              finalText: prompt,
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed' as const,
              toolTrace: [],
            };
          },
        };
      },
    });

    await manager.spawnAgent({
      fork_context: true,
      message: 'child task',
      parent_context: {
        conversation_items: [
          { content: [{ text: 'hello', type: 'input_text' }], role: 'user', type: 'message' },
        ],
        current_plan: {
          explanation: 'Track progress',
          steps: [{ status: 'in_progress', step: 'Implement child task' }],
        },
      },
    });

    expect(seeds).toEqual([
      {
        conversation_items: [
          { content: [{ text: 'hello', type: 'input_text' }], role: 'user', type: 'message' },
        ],
        current_plan: {
          explanation: 'Track progress',
          steps: [{ status: 'in_progress', step: 'Implement child task' }],
        },
      },
    ]);
  });

  test('preserves structured image input when the child session supports runMessage', async () => {
    const messages: ResponseMessageItem[] = [];
    const manager = createInProcessAgentManager({
      createSession() {
        return {
          async run(prompt: string) {
            throw new Error(`unexpected prompt fallback: ${prompt}`);
          },
          async runMessage(message: ResponseMessageItem) {
            messages.push(message);
            return {
              compactionsUsed: 0,
              finalText: 'done',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed' as const,
              toolTrace: [],
            };
          },
        };
      },
    });

    const spawned = await manager.spawnAgent({
      items: [
        { text: 'inspect this image', type: 'text' },
        { image_url: 'https://example.com/badge.png', type: 'image' },
      ],
      message: 'child task',
    });
    await manager.waitForAgents({ targets: [spawned.agentId ?? 'missing'], timeoutMs: 1_000 });

    expect(messages).toEqual([
      {
        content: [
          { text: 'child task', type: 'input_text' },
          { text: 'inspect this image', type: 'input_text' },
          { image_url: 'https://example.com/badge.png', type: 'input_image' },
        ],
        role: 'user',
        type: 'message',
      },
    ]);
  });
});
