import { PassThrough } from 'node:stream';

import type { AgentEvent, AgentRunResult, ToolExecutionResult } from '@bond/agent';
import type { EvalRunReport } from '@bond/evals';

export function makeSmokeSession(prompts: string[]) {
  return {
    async *stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult> {
      prompts.push(prompt);

      if (prompt === 'inspect') {
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', kind: 'function', name: 'shell' },
          kind: 'tool-call',
        };
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', kind: 'function', name: 'shell' },
          kind: 'tool-result',
          result: makeToolResult(),
        };
      }

      if (prompt === 'plan') {
        yield {
          call: {
            id: 'call_plan',
            inputText: '{"plan":[{"step":"Implement the change","status":"in_progress"}]}',
            kind: 'function',
            name: 'update_plan',
          },
          kind: 'tool-call',
        };
        yield {
          call: {
            id: 'call_plan',
            inputText: '{"plan":[{"step":"Implement the change","status":"in_progress"}]}',
            kind: 'function',
            name: 'update_plan',
          },
          kind: 'tool-result',
          result: {
            content:
              '<current_plan>\nSteps:\n- [in_progress] Implement the change\n</current_plan>',
            metadata: {
              plan: { steps: [{ status: 'in_progress', step: 'Implement the change' }] },
            },
            name: 'update_plan',
            summary: 'steps=1 completed=0 in_progress=1',
          },
        };
        yield {
          kind: 'plan-update',
          plan: { steps: [{ status: 'in_progress', step: 'Implement the change' }] },
        };
      }

      yield { chunk: `done:${prompt}`, kind: 'text-delta' };

      const result = {
        compactionsUsed: 0,
        finalText: `done:${prompt}`,
        inputItems: [],
        stepsUsed: 1,
        stopReason: 'completed',
        toolTrace: [],
      } satisfies AgentRunResult;

      yield { kind: 'end', result };

      return result;
    },
  };
}

export class MemoryStream extends PassThrough {
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

    return super.write(chunk, encoding ?? 'utf8', callback);
  }

  text(): string {
    return this.chunks.join('');
  }
}

function makeToolResult(): ToolExecutionResult {
  return { content: '{"stdout":"test"}', name: 'shell', summary: 'exit=0 timedOut=false cwd=/tmp' };
}

export function makeEvalReport(): EvalRunReport {
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
    runId: 'run-demo',
    startedAt: '2026-03-19T00:00:00.000Z',
    status: {
      compactionsUsed: 0,
      stepsUsed: 2,
      stopReason: 'completed',
      toolTrace: [],
      toolUsage: { callCounts: {}, usedTools: [] },
    },
  };
}
