import { describe, expect, test } from 'bun:test';

import {
  AgentSession,
  createShellTool,
  type Message,
  type ModelClient,
  type ModelTurnEvent,
  type ModelTurnParams,
  type ModelTurnResult,
} from '@bond/agent-core';

describe('AgentSession', () => {
  test('runs a tool call and returns the final answer', async () => {
    const client = new ScriptedModelClient([
      {
        stopReason: 'tool_calls',
        text: 'Inspecting the workspace.',
        toolCalls: [{ id: 'call_1', inputText: '{"command":"printf hello"}', name: 'shell' }],
      },
      (params) => {
        const lastMessage = params.messages.at(-1);
        expect(lastMessage?.role).toBe('tool');
        expect(lastMessage?.content).toContain('"stdout": "hello"');

        return { stopReason: 'stop', text: 'The command printed hello.', toolCalls: [] };
      },
    ]);

    const session = new AgentSession({
      client,
      cwd: process.cwd(),
      model: 'test-model',
      tools: [createShellTool()],
    });

    const result = await session.run('say hello');

    expect(result.stopReason).toBe('completed');
    expect(result.stepsUsed).toBe(2);
    expect(result.finalText).toBe('The command printed hello.');
    expect(result.messages.some((message) => message.role === 'tool')).toBe(true);
  });
});

class ScriptedModelClient implements ModelClient {
  private index = 0;

  constructor(
    private readonly steps: Array<ModelTurnResult | ((params: ModelTurnParams) => ModelTurnResult)>,
  ) {}

  async *streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    const step = this.steps[this.index];
    this.index += 1;

    const result =
      typeof step === 'function'
        ? step({ ...params, messages: params.messages.map((message) => cloneMessage(message)) })
        : step;

    if (result.text) {
      yield { chunk: result.text, kind: 'text-delta' };
    }

    return result;
  }
}

function cloneMessage(message: Message): Message {
  return structuredClone(message);
}
