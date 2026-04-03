import { afterEach, describe, expect, test } from 'bun:test';

import { OpenAIResponsesClient } from '@bond/agent';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAIResponsesClient', () => {
  test('streams text deltas and returns finalized assistant output', async () => {
    let requestBody = '';
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
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
    }) as unknown as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const iterator = client.streamTurn({
      input: [],
      instructions: 'system prompt',
      model: 'gpt-test',
      tools: [
        { description: 'z', inputSchema: { type: 'object' }, kind: 'function', name: 'zeta' },
        { description: 'a', inputSchema: { type: 'object' }, kind: 'function', name: 'alpha' },
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
      )) as unknown as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const iterator = client.streamTurn({
      input: [],
      instructions: 'system prompt',
      model: 'gpt-test',
      tools: [
        { description: 'shell', inputSchema: { type: 'object' }, kind: 'function', name: 'shell' },
      ],
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
          { id: 'call_1', inputText: '{"command":"pwd"}', kind: 'function', name: 'shell' },
        ]);
        break;
      }

      events.push(next.value.kind);
    }
  });

  test('serializes custom tools and parses custom tool calls', async () => {
    let requestBody = '';
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestBody = String(init?.body ?? '');

      return new Response(
        toSseStream([
          {
            response: {
              output: [
                {
                  call_id: 'call_custom',
                  input: '*** Begin Patch\n*** End Patch',
                  name: 'functions.apply_patch',
                  type: 'custom_tool_call',
                },
                {
                  call_id: 'call_view',
                  output: [
                    { detail: null, image_url: 'data:image/png;base64,abc', type: 'input_image' },
                  ],
                  type: 'custom_tool_call_output',
                },
              ],
            },
            type: 'response.completed',
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const iterator = client.streamTurn({
      input: [],
      instructions: 'system prompt',
      model: 'gpt-test',
      tools: [
        {
          description: 'patch files',
          format: { definition: 'start: "x"', syntax: 'lark', type: 'grammar' },
          kind: 'custom',
          name: 'functions.apply_patch',
        },
      ],
    });
    const next = await iterator.next();

    if (!next.done) {
      throw new Error('expected a completed response without deltas');
    }

    expect(JSON.parse(requestBody).tools).toEqual([
      {
        description: 'patch files',
        format: { definition: 'start: "x"', syntax: 'lark', type: 'grammar' },
        name: 'functions_u002e_apply_patch',
        type: 'custom',
      },
    ]);
    expect(next.value.toolCalls).toEqual([
      {
        id: 'call_custom',
        inputText: '*** Begin Patch\n*** End Patch',
        kind: 'custom',
        name: 'functions.apply_patch',
      },
    ]);
    expect(next.value.items).toEqual([
      {
        call_id: 'call_custom',
        input: '*** Begin Patch\n*** End Patch',
        name: 'functions.apply_patch',
        type: 'custom_tool_call',
      },
      {
        call_id: 'call_view',
        output: [{ detail: null, image_url: 'data:image/png;base64,abc', type: 'input_image' }],
        type: 'custom_tool_call_output',
      },
    ]);
  });

  test('sanitizes dotted tool names for the API and remaps them on the response', async () => {
    let requestBody = '';
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestBody = String(init?.body ?? '');

      return new Response(
        toSseStream([
          {
            response: {
              output: [
                {
                  arguments: '{"cmd":"pwd"}',
                  call_id: 'call_exec',
                  name: 'functions_u002e_exec_command',
                  type: 'function_call',
                },
              ],
            },
            type: 'response.completed',
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const next = await client
      .streamTurn({
        input: [
          {
            arguments: '{"cmd":"ls"}',
            call_id: 'previous_call',
            name: 'functions.exec_command',
            type: 'function_call',
          },
        ],
        instructions: 'system prompt',
        model: 'gpt-test',
        tools: [
          {
            description: 'run a command',
            inputSchema: { type: 'object' },
            kind: 'function',
            name: 'functions.exec_command',
          },
        ],
      })
      .next();

    if (!next.done) {
      throw new Error('expected a completed response without deltas');
    }

    const parsedBody = JSON.parse(requestBody) as {
      input: Array<Record<string, unknown>>;
      tools: Array<Record<string, unknown>>;
    };

    expect(parsedBody.tools).toEqual([
      {
        description: 'run a command',
        name: 'functions_u002e_exec_command',
        parameters: { type: 'object' },
        strict: false,
        type: 'function',
      },
    ]);
    expect(parsedBody.input).toEqual([
      {
        arguments: '{"cmd":"ls"}',
        call_id: 'previous_call',
        name: 'functions_u002e_exec_command',
        type: 'function_call',
      },
    ]);
    expect(next.value.items).toEqual([
      {
        arguments: '{"cmd":"pwd"}',
        call_id: 'call_exec',
        name: 'functions.exec_command',
        type: 'function_call',
      },
    ]);
    expect(next.value.toolCalls).toEqual([
      {
        id: 'call_exec',
        inputText: '{"cmd":"pwd"}',
        kind: 'function',
        name: 'functions.exec_command',
      },
    ]);
  });

  test('forwards reasoning effort to the Responses API when requested', async () => {
    let requestBody = '';
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestBody = String(init?.body ?? '');

      return new Response(
        toSseStream([
          {
            response: {
              output: [
                {
                  content: [{ text: 'ok', type: 'output_text' }],
                  role: 'assistant',
                  type: 'message',
                },
              ],
            },
            type: 'response.completed',
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const client = new OpenAIResponsesClient({ apiKey: 'test-key' });
    const next = await client
      .streamTurn({
        input: [],
        instructions: 'system prompt',
        model: 'gpt-test',
        reasoningEffort: 'high',
        tools: [],
      })
      .next();

    if (!next.done) {
      throw new Error('expected a completed response without deltas');
    }

    expect(JSON.parse(requestBody).reasoning).toEqual({ effort: 'high' });
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
