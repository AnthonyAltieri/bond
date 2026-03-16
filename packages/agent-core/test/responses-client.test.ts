import { afterEach, describe, expect, test } from 'bun:test';

import { OpenAIResponsesClient } from '@bond/agent-core';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAIResponsesClient', () => {
  test('streams text deltas and returns finalized assistant output', async () => {
    let requestBody = '';
    globalThis.fetch = (async (_input, init) => {
      requestBody = String(init?.body ?? '');

      return new Response(
        toSseStream([
          { delta: 'Hel', type: 'response.output_text.delta' },
          { delta: 'lo', type: 'response.output_text.delta' },
          {
            response: {
              output: [
                {
                  content: [{ text: 'Hello', type: 'output_text' }],
                  role: 'assistant',
                  type: 'message',
                },
              ],
              usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
            },
            type: 'response.completed',
          },
        ]),
      );
    }) as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const iterator = client.streamTurn({
      input: [],
      instructions: 'system prompt',
      model: 'gpt-test',
      tools: [
        { description: 'z', inputSchema: { type: 'object' }, name: 'zeta' },
        { description: 'a', inputSchema: { type: 'object' }, name: 'alpha' },
      ],
    });
    const chunks: string[] = [];

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        expect(chunks).toEqual(['Hel', 'lo']);
        expect(next.value.assistantText).toBe('Hello');
        expect(next.value.items).toEqual([
          { content: [{ text: 'Hello', type: 'output_text' }], role: 'assistant', type: 'message' },
        ]);
        expect(JSON.parse(requestBody).tools.map((tool: { name: string }) => tool.name)).toEqual([
          'alpha',
          'zeta',
        ]);
        break;
      }

      chunks.push(next.value.chunk);
    }
  });

  test('returns reasoning and function calls from the completed response', async () => {
    globalThis.fetch = (async () =>
      new Response(
        toSseStream([
          { delta: 'Thinking', type: 'response.reasoning_summary_text.delta' },
          {
            response: {
              output: [
                {
                  encrypted_content: 'secret',
                  summary: [{ text: 'Thinking', type: 'summary_text' }],
                  type: 'reasoning',
                },
                {
                  arguments: '{"command":"pwd"}',
                  call_id: 'call_1',
                  name: 'shell',
                  type: 'function_call',
                },
              ],
            },
            type: 'response.completed',
          },
        ]),
      )) as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const iterator = client.streamTurn({
      input: [],
      instructions: 'system prompt',
      model: 'gpt-test',
      tools: [{ description: 'shell', inputSchema: { type: 'object' }, name: 'shell' }],
    });
    const events: string[] = [];

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        expect(events).toEqual(['reasoning-delta']);
        expect(next.value.items).toEqual([
          {
            encrypted_content: 'secret',
            summary: [{ text: 'Thinking', type: 'summary_text' }],
            type: 'reasoning',
          },
          {
            arguments: '{"command":"pwd"}',
            call_id: 'call_1',
            name: 'shell',
            type: 'function_call',
          },
        ]);
        expect(next.value.toolCalls).toEqual([
          { id: 'call_1', inputText: '{"command":"pwd"}', name: 'shell' },
        ]);
        break;
      }

      events.push(next.value.kind);
    }
  });
});

function toSseStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
