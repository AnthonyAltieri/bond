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
} from '@bond/agent';
import { createLocalToolset } from '@bond/tools';
import { createPlanTool } from '@bond/tools/plan';
import { createShellTool } from '@bond/tools/shell';

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
        toolCalls: [
          {
            id: 'call_1',
            inputText: '{"command":"printf hello"}',
            kind: 'function',
            name: 'shell',
          },
        ],
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
        toolCalls: [
          {
            id: 'call_1',
            inputText: '{"command":"printf hello"}',
            kind: 'function',
            name: 'shell',
          },
        ],
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
            kind: 'function',
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
            kind: 'function',
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
            kind: 'function',
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
        content: [
          { text: expect.stringContaining('# Execution Environment Context'), type: 'input_text' },
        ],
        role: 'user',
        type: 'message',
      });
      expect(items[2]).toEqual({
        content: [{ text: expect.stringContaining('- shell: zsh'), type: 'input_text' }],
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
      content: [
        {
          text: expect.stringContaining('Tool schemas are available in the API tool definitions'),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
  });

  test('includes delegation guidance when child-agent tools are available', () => {
    const result = buildPrompt(
      createPromptSectionContext({
        cwd: process.cwd(),
        now: new Date('2026-03-20T12:00:00.000Z'),
        shell: 'zsh',
        toolDefinitions: createLocalToolset().map((tool) => tool.definition),
      }),
    );

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      throw result.error;
    }

    expect(result.value[1]).toEqual({
      content: [{ text: expect.stringContaining('# Delegation Guidance'), type: 'input_text' }],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        { text: expect.stringContaining('# Tool Selection Heuristics'), type: 'input_text' },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining('Use functions.spawn_agent when there is independent work'),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'If the user asks to use subagents, helper agents, parallelize the task, delegate, split investigations, fan work out, or do research in parallel',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'Prefer the most specialized tool that directly matches the user request or artifact you need to inspect; use shell as a fallback rather than the default.',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'use functions.view_image instead of guessing from filenames or shell metadata',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'use functions.exec_command to start it instead of repeatedly launching one-shot shell commands',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'continue the same process with functions.write_stdin instead of restarting it',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'use functions.wait_agent to gather the results back when you are ready to integrate them',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'Do not use multi_tool_use.parallel to orchestrate child-agent lifecycle calls; call functions.spawn_agent and functions.wait_agent directly.',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'Use multi_tool_use.parallel for safe independent tool calls',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining(
            'call the wrapper directly instead of substituting equivalent direct tool calls',
          ),
          type: 'input_text',
        },
      ],
      role: 'developer',
      type: 'message',
    });
    expect(result.value[1]).toEqual({
      content: [
        {
          text: expect.stringContaining('Payload shape example: {"tool_uses"'),
          type: 'input_text',
        },
      ],
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
      'When child-agent tools are available, delegate independent side tasks so you can keep the main thread focused on the critical path.',
    );
    expect(prompt).toContain(
      'If the user asks to use subagents, helper agents, parallelize work, delegate, split investigations, fan out, or research in parallel, treat that as explicit permission to spawn child agents for independent slices and then gather their results back.',
    );
    expect(prompt).toContain(
      'Prefer parallel child agents for non-blocking exploration, verification, or implementation slices with disjoint scope, and wait only when you are actually blocked on their result.',
    );
    expect(prompt).toContain(
      'Prefer the most specialized tool whose semantics match the user intent or required artifact, and treat shell as a fallback when no more direct tool fits.',
    );
    expect(prompt).toContain(
      'Choose the tool path that is most likely to finish the task with the fewest retries and least redundant probing, not the broadest generic tool.',
    );
    expect(prompt).toContain(
      'When the task explicitly requires a named tool, call that exact tool instead of substituting a similar one.',
    );
    expect(prompt).toContain(
      'If the task requires a wrapper tool such as multi_tool_use.parallel and gives an exact payload or step ordering, emit that wrapper call directly instead of decomposing it into equivalent lower-level calls.',
    );
    expect(prompt).toContain(
      'Use child-agent lifecycle tools directly for delegation; do not wrap functions.spawn_agent or functions.wait_agent inside multi_tool_use.parallel.',
    );
    expect(prompt).toContain(
      'If the task depends on what an image shows, inspect it with the image-viewing tool instead of inferring from filenames, paths, or shell output.',
    );
    expect(prompt).toContain(
      'If the task implies an interactive or persistent process, use the persistent exec session tools instead of restarting one-shot shell commands.',
    );
    expect(prompt).toContain(
      'If you need to make scoped file edits, prefer the patching tool over shell-based file rewriting.',
    );
    expect(prompt).toContain(
      'If repository-local resources or templates are available through dedicated resource tools, prefer those direct reads over shell exploration.',
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
  const message = input.find(
    (item): item is Extract<ResponseInputItem, { type: 'message' }> =>
      item.type === 'message' &&
      item.role === 'user' &&
      item.content.some(
        (part) => part.type === 'input_text' && part.text.includes('<current_plan>'),
      ),
  );

  return message?.content[0]?.type === 'input_text' ? message.content[0].text : undefined;
}
