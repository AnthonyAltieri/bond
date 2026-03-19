import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import {
  AgentSession,
  buildPromptScaffold,
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  type ModelClient,
  type ModelTurnEvent,
  type ModelTurnParams,
  type ModelTurnResult,
  type ResponseInputItem,
} from '@bond/agent-core';
import { createShellTool } from '@bond/tool-shell';

describe('AgentSession', () => {
  test('runs a tool call and appends function call output', async () => {
    const client = new ScriptedModelClient([
      {
        assistantText: 'Inspecting the workspace.',
        items: [
          {
            arguments: '{"command":"printf hello"}',
            call_id: 'call_1',
            name: 'shell',
            type: 'function_call',
          },
        ],
        toolCalls: [{ id: 'call_1', inputText: '{"command":"printf hello"}', name: 'shell' }],
      },
      (params) => {
        const lastItem = params.input.at(-1);
        expect(lastItem).toEqual({
          call_id: 'call_1',
          output: expect.stringContaining('"stdout": "hello"'),
          type: 'function_call_output',
        });

        return {
          assistantText: 'The command printed hello.',
          items: [
            {
              content: [{ text: 'The command printed hello.', type: 'output_text' }],
              role: 'assistant',
              type: 'message',
            },
          ],
          toolCalls: [],
        };
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
    expect(result.compactionsUsed).toBe(0);
    expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
  });

  test('compacts the conversation before the follow-up model turn', async () => {
    const client = new ScriptedModelClient([
      {
        assistantText: '',
        items: [
          {
            arguments: '{"command":"printf hello"}',
            call_id: 'call_1',
            name: 'shell',
            type: 'function_call',
          },
        ],
        toolCalls: [{ id: 'call_1', inputText: '{"command":"printf hello"}', name: 'shell' }],
      },
      (params) => {
        expect(params.tools).toEqual([]);

        return {
          assistantText: [
            'Active Goal',
            '- Say hello',
            'Constraints',
            '- Be concise',
            'Relevant Files',
            '- None',
            'Key Findings',
            '- The shell can print hello',
            'Remaining Work',
            '- Respond to the user',
            'User Preferences',
            '- Concise answers',
          ].join('\n'),
          items: [
            {
              content: [{ text: 'summary', type: 'output_text' }],
              role: 'assistant',
              type: 'message',
            },
          ],
          toolCalls: [],
        };
      },
      (params) => {
        const summaryText = [
          'Active Goal',
          '- Say hello',
          'Constraints',
          '- Be concise',
          'Relevant Files',
          '- None',
          'Key Findings',
          '- The shell can print hello',
          'Remaining Work',
          '- Respond to the user',
          'User Preferences',
          '- Concise answers',
        ].join('\n');

        expect(params.input.at(-2)).toEqual({
          content: [{ text: summaryText, type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        });
        expect(params.input.at(-1)).toEqual({
          content: [
            {
              text: 'Continue the current task using the summary above. Preserve all constraints and avoid redoing completed work unless needed.',
              type: 'input_text',
            },
          ],
          role: 'user',
          type: 'message',
        });

        return {
          assistantText: 'Hello.',
          items: [
            {
              content: [{ text: 'Hello.', type: 'output_text' }],
              role: 'assistant',
              type: 'message',
            },
          ],
          toolCalls: [],
        };
      },
    ]);

    const session = new AgentSession({
      autoCompactTokenLimit: 1,
      client,
      cwd: process.cwd(),
      model: 'test-model',
      tools: [createShellTool()],
    });

    const events: string[] = [];

    for await (const event of session.stream('say hello')) {
      events.push(event.kind);
    }

    expect(events).toContain('compaction-start');
    expect(events).toContain('compaction-complete');
  });
});

describe('buildPromptScaffold', () => {
  test('includes repo instructions and environment context', async () => {
    const tempRoot = await mkdtemp(`${process.cwd()}/tmp-agent-core-`);
    const nestedDirectory = `${tempRoot}/nested`;

    try {
      await writeFile(`${tempRoot}/.git`, '');
      await writeFile(`${tempRoot}/AGENTS.md`, 'Root instructions');
      await writeFile(`${nestedDirectory}/AGENTS.override.md`, 'Nested instructions');

      const items = buildPromptScaffold({ cwd: nestedDirectory, shell: 'zsh' });

      expect(items).toHaveLength(3);
      expect(items[1]).toEqual({
        content: [{ text: expect.stringContaining('Root instructions'), type: 'input_text' }],
        role: 'developer',
        type: 'message',
      });
      expect(items[1]).toEqual({
        content: [{ text: expect.stringContaining('Nested instructions'), type: 'input_text' }],
        role: 'developer',
        type: 'message',
      });
      expect(items[2]).toEqual({
        content: [{ text: expect.stringContaining('<shell>zsh</shell>'), type: 'input_text' }],
        role: 'user',
        type: 'message',
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe('buildSystemPrompt', () => {
  test('builds a stable sectioned system prompt', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('[Role]');
    expect(prompt).toContain('[Execution Workflow]');
    expect(prompt).toContain('[Verification]');
    expect(prompt).toContain('Verify any meaningful behavior change before you stop.');
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
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
        ? step({ ...params, input: params.input.map((item) => cloneItem(item)) })
        : step;

    if (result.assistantText) {
      yield { chunk: result.assistantText, kind: 'text-delta' };
    }

    return result;
  }
}

function cloneItem(item: ResponseInputItem): ResponseInputItem {
  return structuredClone(item);
}

async function mkdtemp(prefix: string): Promise<string> {
  const directory = `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(`${directory}/nested`, { recursive: true });
  return directory;
}
