import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { isErr, isOk } from '@alt-stack/result';
import {
  AgentSession,
  buildPrompt,
  buildPromptScaffold,
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  type AgentEvent,
  type ModelClient,
  type ModelTurnEvent,
  type ModelTurnParams,
  type ModelTurnResult,
  type PromptSectionContext,
  type ResponseInputItem,
} from '@bond/agent-core';
import { createPlanTool } from '@bond/tool-plan';
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

  test('emits plan updates and returns the latest plan snapshot', async () => {
    const client = new ScriptedModelClient([
      {
        assistantText: 'Making a plan.',
        items: [
          {
            arguments: JSON.stringify({
              explanation: 'Keep progress visible.',
              plan: [
                { status: 'completed', step: 'Inspect the repo' },
                { status: 'in_progress', step: 'Implement the tool' },
                { status: 'pending', step: 'Run focused tests' },
              ],
            }),
            call_id: 'call_plan',
            name: 'update_plan',
            type: 'function_call',
          },
        ],
        toolCalls: [
          {
            id: 'call_plan',
            inputText: JSON.stringify({
              explanation: 'Keep progress visible.',
              plan: [
                { status: 'completed', step: 'Inspect the repo' },
                { status: 'in_progress', step: 'Implement the tool' },
                { status: 'pending', step: 'Run focused tests' },
              ],
            }),
            name: 'update_plan',
          },
        ],
      },
      (params) => {
        expect(findCurrentPlanMessage(params.input)).toContain(
          '- [in_progress] Implement the tool',
        );

        return {
          assistantText: 'Implemented the tool.',
          items: [
            {
              content: [{ text: 'Implemented the tool.', type: 'output_text' }],
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
      tools: [createPlanTool()],
    });

    const planEvents: AgentEvent[] = [];
    const iterator = session.stream('implement the planning tool');
    let result;

    while (true) {
      const next = await iterator.next();

      if (next.done) {
        result = next.value;
        break;
      }

      if (next.value.kind === 'plan-update') {
        planEvents.push(next.value);
      }
    }

    expect(planEvents).toHaveLength(1);
    expect(planEvents[0]).toEqual({
      kind: 'plan-update',
      plan: {
        explanation: 'Keep progress visible.',
        steps: [
          { status: 'completed', step: 'Inspect the repo' },
          { status: 'in_progress', step: 'Implement the tool' },
          { status: 'pending', step: 'Run focused tests' },
        ],
      },
    });
    expect(result?.plan).toEqual({
      explanation: 'Keep progress visible.',
      steps: [
        { status: 'completed', step: 'Inspect the repo' },
        { status: 'in_progress', step: 'Implement the tool' },
        { status: 'pending', step: 'Run focused tests' },
      ],
    });
  });

  test('keeps the current plan in prompt context across compaction', async () => {
    const client = new ScriptedModelClient([
      {
        assistantText: 'Planning the task.',
        items: [
          {
            arguments: JSON.stringify({
              plan: [
                { status: 'completed', step: 'Read the task' },
                { status: 'in_progress', step: 'Make the main change' },
              ],
            }),
            call_id: 'call_plan',
            name: 'update_plan',
            type: 'function_call',
          },
        ],
        toolCalls: [
          {
            id: 'call_plan',
            inputText: JSON.stringify({
              plan: [
                { status: 'completed', step: 'Read the task' },
                { status: 'in_progress', step: 'Make the main change' },
              ],
            }),
            name: 'update_plan',
          },
        ],
      },
      (params) => {
        expect(params.tools).toEqual([]);
        expect(findCurrentPlanMessage(params.input)).toContain(
          '- [in_progress] Make the main change',
        );

        return {
          assistantText: [
            'Active Goal',
            '- Finish the task',
            'Constraints',
            '- Keep the change small',
            'Relevant Files',
            '- packages/agent-core/src/agent-session.ts',
            'Key Findings',
            '- There is a current plan',
            'Remaining Work',
            '- Produce the final answer',
            'User Preferences',
            '- Be concise',
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
        expect(findCurrentPlanMessage(params.input)).toContain(
          '- [in_progress] Make the main change',
        );

        return {
          assistantText: 'Done.',
          items: [
            {
              content: [{ text: 'Done.', type: 'output_text' }],
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
      tools: [createPlanTool()],
    });

    const result = await session.run('finish the task');

    expect(result.compactionsUsed).toBe(1);
    expect(result.plan).toEqual({
      steps: [
        { status: 'completed', step: 'Read the task' },
        { status: 'in_progress', step: 'Make the main change' },
      ],
    });
  });

  test('does not inject the previous current plan into a new top-level turn', async () => {
    const client = new ScriptedModelClient([
      {
        assistantText: 'Creating a plan.',
        items: [
          {
            arguments: JSON.stringify({
              plan: [{ status: 'in_progress', step: 'Handle the first task' }],
            }),
            call_id: 'call_plan',
            name: 'update_plan',
            type: 'function_call',
          },
        ],
        toolCalls: [
          {
            id: 'call_plan',
            inputText: JSON.stringify({
              plan: [{ status: 'in_progress', step: 'Handle the first task' }],
            }),
            name: 'update_plan',
          },
        ],
      },
      {
        assistantText: 'First turn finished.',
        items: [
          {
            content: [{ text: 'First turn finished.', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        toolCalls: [],
      },
      (params) => {
        expect(findCurrentPlanMessage(params.input)).toBeUndefined();

        return {
          assistantText: 'Second turn finished.',
          items: [
            {
              content: [{ text: 'Second turn finished.', type: 'output_text' }],
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
      tools: [createPlanTool()],
    });

    const firstResult = await session.run('first task');
    const secondResult = await session.run('second task');

    expect(firstResult.plan).toEqual({
      steps: [{ status: 'in_progress', step: 'Handle the first task' }],
    });
    expect(secondResult.plan).toBeUndefined();
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

      const result = buildPromptScaffold({ cwd: nestedDirectory, shell: 'zsh' });

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        throw result.error;
      }

      const items = result.value;

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

describe('buildPrompt', () => {
  test('includes tool guidance when tool definitions are provided', () => {
    const result = buildPrompt(
      createPromptSectionContext({
        cwd: process.cwd(),
        now: new Date('2026-03-20T12:00:00.000Z'),
        shell: 'zsh',
        toolDefinitions: [createShellTool().definition],
      }),
    );

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value[1]).toEqual({
      content: [{ text: expect.stringContaining('shell:'), type: 'input_text' }],
      role: 'developer',
      type: 'message',
    });
  });

  test('returns a tagged error when the next user input is invalid', () => {
    const result = buildPrompt(
      createPromptSectionContext({
        cwd: process.cwd(),
        now: new Date('2026-03-20T12:00:00.000Z'),
        shell: 'zsh',
      }),
      {
        content: [{ text: 'assistant text is not valid user input', type: 'output_text' }],
        role: 'user',
        type: 'message',
      } as never,
    );

    expect(isErr(result)).toBe(true);

    if (!isErr(result)) {
      throw new Error('Expected buildPrompt to fail');
    }

    expect(result.error._tag).toBe('PromptScaffoldInvalidUserInputError');
  });

  test('returns a tagged error when execution context receives an invalid date', () => {
    const result = buildPrompt(
      createPromptSectionContext({ cwd: process.cwd(), now: new Date(Number.NaN), shell: 'zsh' }),
    );

    expect(isErr(result)).toBe(true);

    if (!isErr(result)) {
      throw new Error('Expected buildPrompt to fail');
    }

    expect(result.error._tag).toBe('PromptScaffoldInvalidExecutionContextError');
  });
});

describe('buildSystemPrompt', () => {
  test('builds a stable sectioned system prompt', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('[Role]');
    expect(prompt).toContain('[Startup Routine]');
    expect(prompt).toContain('[Execution Loop]');
    expect(prompt).toContain('[Legibility And Tool Use]');
    expect(prompt).toContain('[Verification Gate]');
    expect(prompt).toContain('[Communication And Handoff]');
    expect(prompt).toContain(
      'Start by getting your bearings from the workspace, repo instructions, relevant files, and available tools before editing.',
    );
    expect(prompt).toContain(
      'Choose one coherent slice of work at a time, make progress on it, and use the observed results to decide the next step.',
    );
    expect(prompt).toContain(
      'When the task is non-trivial, use update_plan to keep a short current plan and work through it methodically instead of making disconnected edits.',
    );
    expect(prompt).toContain(
      'Treat implemented and verified as different states: verify any meaningful behavior change before you stop.',
    );
    expect(prompt).toContain(
      'State the completed scope, the verification you actually performed, and any remaining risk or blocked work.',
    );
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

function createPromptSectionContext(
  overrides: Partial<PromptSectionContext> & Pick<PromptSectionContext, 'cwd' | 'now' | 'shell'>,
): PromptSectionContext {
  return {
    cwd: overrides.cwd,
    history: overrides.history ?? [],
    maxRepoInstructionsChars: overrides.maxRepoInstructionsChars ?? 32 * 1024,
    now: overrides.now,
    shell: overrides.shell,
    toolDefinitions: overrides.toolDefinitions ?? [],
  };
}

function findCurrentPlanMessage(input: ResponseInputItem[]): string | undefined {
  return input.find(
    (item) =>
      item.type === 'message' &&
      item.role === 'user' &&
      item.content.some(
        (part) => part.type === 'input_text' && part.text.includes('<current_plan>'),
      ),
  )?.content[0]?.text;
}
