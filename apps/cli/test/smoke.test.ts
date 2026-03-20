import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';

import type {
  AgentEvent,
  AgentRunResult,
  EvalRunReport,
  ToolExecutionResult,
} from '@bond/agent-core';

import { runCli } from '../src/run-cli.ts';

describe('cli smoke', () => {
  test('handles a one-shot prompt with tool activity', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const prompts: string[] = [];

    const exitCode = await runCli(['inspect'], {
      createSession: () => makeSmokeSession(prompts),
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(prompts).toEqual(['inspect']);
    expect(stdout.text()).toContain('done:inspect');
    expect(stderr.text()).toContain('[tool:shell]');
  });

  test('handles a brief interactive session', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const prompts: string[] = [];
    const stdin = new PassThrough();
    stdin.end('first\nsecond\nquit\n');

    const exitCode = await runCli([], {
      createSession: () => makeSmokeSession(prompts),
      stderr,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(prompts).toEqual(['first', 'second']);
    expect(stdout.text()).toContain('done:first');
    expect(stdout.text()).toContain('done:second');
    expect(stderr.text()).toBe('');
  });

  test('runs the eval subcommand and reports the JSON output path', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const writtenReports: Array<{ path: string; report: EvalRunReport }> = [];

    const exitCode = await runCli(
      ['eval', '--manifest', 'evals/demo.json', '--case', 'demo', '--output', 'reports/demo.json'],
      {
        cwd: '/workspace',
        env: {
          OPENAI_API_KEY: 'test-key',
          OPENAI_JUDGE_MODEL: 'judge-model',
          OPENAI_MODEL: 'agent-model',
        },
        evalCommand: {
          loadManifest: async () =>
            JSON.stringify({
              cases: [
                {
                  description: 'Demo case',
                  id: 'demo',
                  prompt: 'Say ok',
                  workingDirectoryMode: 'repo',
                },
              ],
              version: 1,
            }),
          runManifest: async () => [makeEvalReport()],
          writeReportFile: async (path, report) => {
            writtenReports.push({ path, report });
          },
        },
        stderr,
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('eval:demo');
    expect(stdout.text()).toContain('correctness=4');
    expect(stdout.text()).toContain('report=/workspace/reports/demo.json');
    expect(writtenReports).toEqual([
      {
        path: '/workspace/reports/demo.json',
        report: makeEvalReport(),
      },
    ]);
    expect(stderr.text()).toBe('');
  });

  test('falls back to the main model when no judge model override is configured', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(['eval', '--manifest', 'evals/demo.json', '--all'], {
      cwd: '/workspace',
      env: {
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'agent-model',
      },
      evalCommand: {
        loadManifest: async () =>
          JSON.stringify({
            cases: [
              {
                description: 'Demo case',
                id: 'demo',
                prompt: 'Say ok',
                workingDirectoryMode: 'repo',
              },
            ],
            version: 1,
          }),
        runManifest: async (_manifest, options) => {
          expect(options.judgeModels).toEqual({
            architecture: 'agent-model',
            correctness: 'agent-model',
            goal: 'agent-model',
            simplicity: 'agent-model',
          });
          return [makeEvalReport()];
        },
        writeReportFile: async () => {},
      },
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('eval:demo');
    expect(stderr.text()).toBe('');
  });

  test('runs the autoresearch subcommand and reports the frontier summary', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      [
        'autoresearch',
        '--manifest',
        'autoresearch.json',
        '--program',
        'program.md',
        '--tag',
        'demo',
        '--max-experiments',
        '2',
      ],
      {
        cwd: '/workspace',
        env: {
          OPENAI_API_KEY: 'test-key',
          OPENAI_MODEL: 'agent-model',
        },
        autoresearchCommand: {
          loadManifest: async () =>
            JSON.stringify({
              editableGlobs: ['apps/cli/src/*.ts'],
              evaluation: {
                rankOrder: [
                  { direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' },
                ],
                sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
              },
              version: 1,
              webResearch: { enabled: true },
            }),
          loadProgram: async () => '# Improve bond',
          runAutoresearch: async (manifest, program, options) => {
            expect(manifest.webResearch.enabled).toBe(true);
            expect(program).toContain('Improve bond');
            expect(options.tag).toBe('demo');
            await options.onProgress?.({
              branchName: 'autoresearch/demo',
              outputDir: '/workspace/.autoresearch/demo',
              record: {
                browsed: true,
                commit: 'abc1234def',
                experiment: 1,
                metrics: [{ metric: 'overall_pass_rate', sourceId: 'bond', value: 1 }],
                sourceResults: [],
                status: 'keep',
                summary: 'Improved eval performance',
              },
              type: 'experiment-complete',
            });
            return {
              branchName: 'autoresearch/demo',
              experiments: [],
              frontierCommit: 'abc1234def5678',
              outputDir: '/workspace/.autoresearch/demo',
            };
          },
        },
        stderr,
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('experiment=0001 status=keep overall_pass_rate=1');
    expect(stdout.text()).toContain('branch=autoresearch/demo');
    expect(stdout.text()).toContain('frontier=abc1234def5678');
    expect(stdout.text()).toContain('output=/workspace/.autoresearch/demo');
    expect(stderr.text()).toBe('');
  });
});

function makeSmokeSession(prompts: string[]) {
  return {
    async *stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult> {
      prompts.push(prompt);

      if (prompt === 'inspect') {
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', name: 'shell' },
          kind: 'tool-call',
        };
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', name: 'shell' },
          kind: 'tool-result',
          result: makeToolResult(),
        };
      }

      yield { chunk: `done:${prompt}`, kind: 'text-delta' };

      const result = {
        compactionsUsed: 0,
        finalText: `done:${prompt}`,
        inputItems: [],
        stepsUsed: 1,
        stopReason: 'completed',
      };

      yield { kind: 'end', result };

      return result;
    },
  };
}

class MemoryStream extends PassThrough {
  private readonly chunks: string[] = [];

  override write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));

    if (typeof encoding === 'function') {
      return super.write(chunk, encoding);
    }

    return super.write(chunk, encoding, callback);
  }

  text(): string {
    return this.chunks.join('');
  }
}

function makeToolResult(): ToolExecutionResult {
  return { content: '{"stdout":"test"}', name: 'shell', summary: 'exit=0 timedOut=false cwd=/tmp' };
}

function makeEvalReport(): EvalRunReport {
  return {
    capturedFiles: [{ content: 'ok', path: 'artifact.txt' }],
    case: {
      description: 'Demo case',
      id: 'demo',
      prompt: 'Say ok',
      workingDirectory: '/workspace',
      workingDirectoryMode: 'repo',
    },
    durationMs: 12,
    finalResponse: 'EVAL_RESULT=ok',
    judgePassed: true,
    judges: {
      blockingIssues: [],
      combinedSummary: 'Combined verdict: pass at 4/5.',
      compositePercent: 75,
      compositeScore: 4,
      needsHumanReview: false,
      passed: true,
      results: [
        {
          confidence: 'high',
          id: 'architecture_critic',
          issues: [],
          label: 'Architecture Critic',
          pass: true,
          passThreshold: 3,
          score: 4,
          strengths: ['Modular'],
          summary: 'Good structure.',
          weight: 0.25,
        },
        {
          confidence: 'high',
          id: 'simplicity_critic',
          issues: [],
          label: 'Simplicity Critic',
          pass: true,
          passThreshold: 3,
          score: 4,
          strengths: ['Small surface'],
          summary: 'Simple enough.',
          weight: 0.15,
        },
        {
          confidence: 'high',
          id: 'correctness_critic',
          issues: [],
          label: 'Correctness Critic',
          pass: true,
          passThreshold: 4,
          score: 4,
          strengths: ['Tests passed'],
          summary: 'Behavior is supported by verification evidence.',
          weight: 0.25,
        },
        {
          confidence: 'high',
          id: 'goal_critic',
          issues: [],
          label: 'Goal Critic',
          pass: true,
          passThreshold: 4,
          score: 4,
          strengths: ['Matches prompt'],
          summary: 'Goal satisfied.',
          weight: 0.35,
        },
      ],
    },
    model: 'agent-model',
    objectiveChecks: [
      {
        command: 'printf ok',
        category: 'test',
        details: 'exit=0 expected=0',
        exitCode: 0,
        name: 'check',
        passed: true,
        stderr: '',
        stdout: 'ok',
      },
    ],
    objectivePassed: true,
    overallPassed: true,
    startedAt: '2026-03-19T00:00:00.000Z',
    status: {
      compactionsUsed: 0,
      stepsUsed: 2,
      stopReason: 'completed',
    },
  };
}
