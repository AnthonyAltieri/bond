import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import type {
  ModelClient,
  ModelTurnEvent,
  ModelTurnParams,
  ModelTurnResult,
  Tool,
  ToolExecutionContext,
} from '@bond/agent';
import {
  formatEvalReportSummary,
  parseEvalManifest,
  runEvalCase,
  runEvalManifest,
  writeEvalReport,
  type EvalRunReport,
} from '@bond/evals';
import { type JudgeProvider, type JudgeProviderRequest } from '@bond/judges';
import { createPlanTool } from '@bond/tools/plan';
import type { z } from 'zod';

describe('eval runner', () => {
  test('parses a JSON eval manifest', async () => {
    const manifest = await parseEvalManifest(
      JSON.stringify({
        cases: [
          {
            description: 'Demo case',
            id: 'demo',
            minSteps: 10,
            prompt: 'Say ok',
            requiredTools: ['shell', 'functions.apply_patch'],
            workingDirectoryMode: 'repo',
          },
        ],
        version: 1,
      }),
    );

    expect(manifest.cases).toHaveLength(1);
    expect(manifest.cases[0]?.id).toBe('demo');
    expect(manifest.cases[0]?.minSteps).toBe(10);
    expect(manifest.cases[0]?.requiredTools).toEqual(['shell', 'functions.apply_patch']);
  });

  test('runs an eval case, captures artifacts, and writes a report', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-runner-`);
    const reportPath = `${tempRoot}/reports/demo.json`;

    try {
      await writeFile(`${tempRoot}/artifact.txt`, 'artifact content');

      const report = await runEvalCase(
        {
          capturePaths: ['artifact.txt'],
          description: 'Checks a repo workspace case',
          finalResponse: { type: 'equals', value: 'EVAL_RESULT=ok' },
          id: 'repo-case',
          objectiveChecks: [
            {
              category: 'test',
              command: 'cat artifact.txt',
              name: 'artifact exists',
              stdoutIncludes: ['artifact content'],
            },
          ],
          prompt: 'Return EVAL_RESULT=ok',
          workingDirectoryMode: 'repo',
        },
        {
          client: new ScriptedModelClient('EVAL_RESULT=ok'),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [],
        },
      );

      await writeEvalReport(reportPath, report);
      const savedReport = JSON.parse(await readFile(reportPath, 'utf8')) as EvalRunReport;

      expect(report.objectivePassed).toBe(true);
      expect(report.judgePassed).toBe(true);
      expect(report.overallPassed).toBe(true);
      expect(report.runId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(report.capturedFiles).toEqual([{ content: 'artifact content', path: 'artifact.txt' }]);
      expect(report.objectiveChecks).toHaveLength(2);
      expect(report.judges.results).toHaveLength(4);
      expect(formatEvalReportSummary(report)).toContain('eval:repo-case');
      expect(formatEvalReportSummary(report)).toContain('correctness=4');
      expect(savedReport.case.id).toBe('repo-case');
      expect(savedReport.runId).toBe(report.runId);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('runs selected cases from a manifest', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-manifest-`);

    try {
      const reports = await runEvalManifest(
        {
          cases: [
            {
              description: 'First case',
              id: 'first',
              prompt: 'Return FIRST',
              workingDirectoryMode: 'repo',
            },
            {
              description: 'Second case',
              id: 'second',
              prompt: 'Return SECOND',
              workingDirectoryMode: 'repo',
            },
          ],
          version: 1,
        },
        {
          caseIds: ['second'],
          client: new ScriptedModelClient('SECOND'),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [],
        },
      );

      expect(reports).toHaveLength(1);
      expect(reports[0]?.case.id).toBe('second');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('fails an objective check that exceeds the configured timeout', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-timeout-`);

    try {
      const report = await runEvalCase(
        {
          commandTimeoutMs: 10,
          description: 'Times out a hanging objective check',
          id: 'timeout-case',
          objectiveChecks: [{ category: 'runtime', command: 'sleep 1', name: 'slow check' }],
          prompt: 'Return ok',
          workingDirectoryMode: 'repo',
        },
        {
          client: new ScriptedModelClient('ok'),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [],
        },
      );

      expect(report.objectivePassed).toBe(false);
      expect(report.objectiveChecks).toHaveLength(1);
      expect(report.objectiveChecks[0]?.passed).toBe(false);
      expect(report.objectiveChecks[0]?.details).toContain('timed_out');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('copies the final plan snapshot into report status when available', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-plan-`);

    try {
      const report = await runEvalCase(
        {
          description: 'Captures the final plan in status',
          id: 'plan-case',
          prompt: 'Return ok',
          workingDirectoryMode: 'repo',
        },
        {
          client: new PlanningModelClient(),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [createPlanTool()],
        },
      );

      expect(report.status.plan).toEqual({
        explanation: 'Track progress.',
        steps: [
          { status: 'completed', step: 'Read the prompt' },
          { status: 'in_progress', step: 'Return ok' },
        ],
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('passes built-in minimum-step and required-tool checks and records tool usage', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-tool-usage-pass-`);

    try {
      const report = await runEvalCase(
        {
          description: 'Tracks tool usage and step minimums',
          id: 'tool-usage-pass',
          minSteps: 3,
          prompt: 'Return ok',
          requiredTools: ['update_plan', 'functions.apply_patch'],
          workingDirectoryMode: 'repo',
        },
        {
          client: new ToolUsingModelClient(),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [createPlanTool(), createNoopCustomTool('functions.apply_patch')],
        },
      );

      expect(report.objectivePassed).toBe(true);
      expect(report.status.stepsUsed).toBe(3);
      expect(report.status.toolTrace).toEqual([
        {
          callId: 'call_plan',
          inputText: JSON.stringify({
            explanation: 'Track progress.',
            plan: [{ status: 'in_progress', step: 'Return ok' }],
          }),
          kind: 'function',
          name: 'update_plan',
          summary: 'steps=1 completed=0 in_progress=1',
        },
        {
          callId: 'call_patch',
          inputText: [
            '*** Begin Patch',
            '*** Add File: artifact.txt',
            '+artifact',
            '*** End Patch',
          ].join('\n'),
          kind: 'custom',
          name: 'functions.apply_patch',
          summary: 'ok',
        },
      ]);
      expect(report.status.toolUsage.usedTools).toEqual(['functions.apply_patch', 'update_plan']);
      expect(report.status.toolUsage.callCounts).toEqual({
        'functions.apply_patch': 1,
        update_plan: 1,
      });
      expect(report.objectiveChecks.map((check) => check.name)).toContain('minimum steps');
      expect(report.objectiveChecks.map((check) => check.name)).toContain('required tools');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('evaluates explicit tool usage checks from the manifest', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-tool-checks-`);

    try {
      const report = await runEvalCase(
        {
          description: 'Checks all_of, any_of, and min_calls tool usage rules',
          id: 'tool-checks',
          prompt: 'Return ok',
          toolUsageChecks: [
            {
              name: 'required edit tools',
              tools: ['update_plan', 'functions.apply_patch'],
              type: 'all_of',
            },
            {
              name: 'some inspection tool',
              tools: ['shell', 'functions.apply_patch'],
              type: 'any_of',
            },
            { minCalls: 1, name: 'plan called once', tool: 'update_plan', type: 'min_calls' },
          ],
          workingDirectoryMode: 'repo',
        },
        {
          client: new ToolUsingModelClient(),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [createPlanTool(), createNoopCustomTool('functions.apply_patch')],
        },
      );

      expect(report.objectivePassed).toBe(true);
      expect(
        report.objectiveChecks.filter((check) => check.name === 'required edit tools')[0],
      ).toMatchObject({ passed: true });
      expect(
        report.objectiveChecks.filter((check) => check.name === 'some inspection tool')[0],
      ).toMatchObject({ passed: true });
      expect(
        report.objectiveChecks.filter((check) => check.name === 'plan called once')[0],
      ).toMatchObject({ passed: true });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('fails the minimum-step built-in check when the run finishes too early', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-min-steps-fail-`);

    try {
      const report = await runEvalCase(
        {
          description: 'Fails when stepsUsed is below minSteps',
          id: 'min-steps-fail',
          minSteps: 4,
          prompt: 'Return ok',
          workingDirectoryMode: 'repo',
        },
        {
          client: new ToolUsingModelClient(),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [createPlanTool(), createNoopCustomTool('functions.apply_patch')],
        },
      );

      const minimumStepsCheck = report.objectiveChecks.find(
        (check) => check.name === 'minimum steps',
      );

      expect(report.objectivePassed).toBe(false);
      expect(minimumStepsCheck?.passed).toBe(false);
      expect(minimumStepsCheck?.details).toContain('at least 4');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('fails the required-tool built-in check when a required tool is missing', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-required-tool-fail-`);

    try {
      const report = await runEvalCase(
        {
          description: 'Fails when a required tool is missing',
          id: 'required-tool-fail',
          prompt: 'Return ok',
          requiredTools: ['update_plan', 'shell'],
          workingDirectoryMode: 'repo',
        },
        {
          client: new ToolUsingModelClient(),
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [createPlanTool(), createNoopCustomTool('functions.apply_patch')],
        },
      );
      const requiredToolsCheck = report.objectiveChecks.find(
        (check) => check.name === 'required tools',
      );

      expect(report.objectivePassed).toBe(false);
      expect(requiredToolsCheck?.passed).toBe(false);
      expect(requiredToolsCheck?.details).toContain('shell');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('renders runId templates into prompt, objective checks, and capture paths', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-runid-`);
    const client = new PromptCapturingModelClient('ok');

    try {
      const report = await runEvalCase(
        {
          capturePaths: ['.outputs/calculator-{{runId}}/artifact.txt'],
          description: 'Renders run-scoped output paths',
          id: 'runid-case',
          objectiveChecks: [
            {
              category: 'test',
              command: [
                'mkdir -p .outputs/calculator-{{runId}}',
                'printf {{runId}} > .outputs/calculator-{{runId}}/artifact.txt',
              ].join('\n'),
              name: 'write rendered artifact',
            },
          ],
          prompt: 'Create the calculator in .outputs/calculator-{{runId}} and return ok',
          workingDirectoryMode: 'repo',
        },
        {
          client,
          judgeModels: {
            architecture: 'judge-arch',
            correctness: 'judge-correct',
            goal: 'judge-goal',
            simplicity: 'judge-simple',
          },
          judgeProvider: new FakeJudgeProvider(),
          model: 'agent-model',
          repoRoot: tempRoot,
          tools: [],
        },
      );

      expect(client.lastPrompt).toContain(`.outputs/calculator-${report.runId}`);
      expect(report.objectivePassed).toBe(true);
      expect(report.capturedFiles).toEqual([
        { content: report.runId, path: `.outputs/calculator-${report.runId}/artifact.txt` },
      ]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('rejects unknown template tokens before running the eval', async () => {
    const tempRoot = await createTempDir(`${process.cwd()}/tmp-eval-bad-template-`);
    const client = new PromptCapturingModelClient('ok');

    try {
      await expect(
        runEvalCase(
          {
            description: 'Rejects unsupported template variables',
            id: 'bad-template-case',
            prompt: 'Create the calculator in .outputs/calculator-{{caseId}}',
            workingDirectoryMode: 'repo',
          },
          {
            client,
            judgeModels: {
              architecture: 'judge-arch',
              correctness: 'judge-correct',
              goal: 'judge-goal',
              simplicity: 'judge-simple',
            },
            judgeProvider: new FakeJudgeProvider(),
            model: 'agent-model',
            repoRoot: tempRoot,
            tools: [],
          },
        ),
      ).rejects.toThrow('Unknown eval template token "caseId" in prompt: {{caseId}}');
      expect(client.lastPrompt).toBeUndefined();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

class FakeJudgeProvider implements JudgeProvider {
  async evaluate<TSchema extends z.ZodType>(
    request: JudgeProviderRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    return request.schema.parse({
      confidence: 'high',
      issues: [],
      pass: true,
      score: 4,
      strengths: ['Consistent'],
      summary: 'Looks good.',
    }) as z.infer<TSchema>;
  }
}

class ScriptedModelClient implements ModelClient {
  constructor(private readonly finalText: string) {}

  async *streamTurn(_params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    yield { chunk: this.finalText, kind: 'text-delta' };

    return {
      assistantText: this.finalText,
      items: [
        {
          content: [{ text: this.finalText, type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      toolCalls: [],
    };
  }
}

class PlanningModelClient implements ModelClient {
  private step = 0;

  async *streamTurn(_params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    this.step += 1;

    if (this.step === 1) {
      return {
        assistantText: 'Planning.',
        items: [
          {
            arguments: JSON.stringify({
              explanation: 'Track progress.',
              plan: [
                { status: 'completed', step: 'Read the prompt' },
                { status: 'in_progress', step: 'Return ok' },
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
              explanation: 'Track progress.',
              plan: [
                { status: 'completed', step: 'Read the prompt' },
                { status: 'in_progress', step: 'Return ok' },
              ],
            }),
            kind: 'function',
            name: 'update_plan',
          },
        ],
      };
    }

    yield { chunk: 'ok', kind: 'text-delta' };

    return {
      assistantText: 'ok',
      items: [
        { content: [{ text: 'ok', type: 'output_text' }], role: 'assistant', type: 'message' },
      ],
      toolCalls: [],
    };
  }
}

class ToolUsingModelClient implements ModelClient {
  private step = 0;

  async *streamTurn(_params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    this.step += 1;

    if (this.step === 1) {
      const argumentsText = JSON.stringify({
        explanation: 'Track progress.',
        plan: [{ status: 'in_progress', step: 'Return ok' }],
      });

      return {
        assistantText: 'Planning.',
        items: [
          {
            arguments: argumentsText,
            call_id: 'call_plan',
            name: 'update_plan',
            type: 'function_call',
          },
        ],
        toolCalls: [
          { id: 'call_plan', inputText: argumentsText, kind: 'function', name: 'update_plan' },
        ],
      };
    }

    if (this.step === 2) {
      const patchText = [
        '*** Begin Patch',
        '*** Add File: artifact.txt',
        '+artifact',
        '*** End Patch',
      ].join('\n');

      return {
        assistantText: 'Editing.',
        items: [
          {
            call_id: 'call_patch',
            input: patchText,
            name: 'functions.apply_patch',
            type: 'custom_tool_call',
          },
        ],
        toolCalls: [
          { id: 'call_patch', inputText: patchText, kind: 'custom', name: 'functions.apply_patch' },
        ],
      };
    }

    yield { chunk: 'ok', kind: 'text-delta' };

    return {
      assistantText: 'ok',
      items: [
        { content: [{ text: 'ok', type: 'output_text' }], role: 'assistant', type: 'message' },
      ],
      toolCalls: [],
    };
  }
}

class PromptCapturingModelClient implements ModelClient {
  lastPrompt?: string;

  constructor(private readonly finalText: string) {}

  async *streamTurn(params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    this.lastPrompt = params.input
      .filter(
        (item): item is Extract<(typeof params.input)[number], { type: 'message' }> =>
          item.type === 'message' && item.role === 'user',
      )
      .flatMap((item) => item.content)
      .filter((part) => part.type === 'input_text')
      .map((part) => part.text)
      .join('\n');

    yield { chunk: this.finalText, kind: 'text-delta' };

    return {
      assistantText: this.finalText,
      items: [
        {
          content: [{ text: this.finalText, type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      toolCalls: [],
    };
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(directory, { recursive: true });
  return directory;
}

function createNoopCustomTool(name: string): Tool {
  return {
    definition: {
      description: 'No-op custom tool for eval runner tests.',
      format: { type: 'text' },
      kind: 'custom',
      name,
    },
    async execute(_inputText: string, _context: ToolExecutionContext) {
      return { content: JSON.stringify({ ok: true }), name, output: 'ok', summary: 'ok' };
    },
    async *stream(inputText: string, context: ToolExecutionContext) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}
