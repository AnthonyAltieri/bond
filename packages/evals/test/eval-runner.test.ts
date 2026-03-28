import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import type { ModelClient, ModelTurnEvent, ModelTurnParams, ModelTurnResult } from '@bond/agent';
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
          { description: 'Demo case', id: 'demo', prompt: 'Say ok', workingDirectoryMode: 'repo' },
        ],
        version: 1,
      }),
    );

    expect(manifest.cases).toHaveLength(1);
    expect(manifest.cases[0]?.id).toBe('demo');
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
      expect(report.capturedFiles).toEqual([{ content: 'artifact content', path: 'artifact.txt' }]);
      expect(report.objectiveChecks).toHaveLength(2);
      expect(report.judges.results).toHaveLength(4);
      expect(formatEvalReportSummary(report)).toContain('eval:repo-case');
      expect(formatEvalReportSummary(report)).toContain('correctness=4');
      expect(savedReport.case.id).toBe('repo-case');
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

async function createTempDir(prefix: string): Promise<string> {
  const directory = `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(directory, { recursive: true });
  return directory;
}
