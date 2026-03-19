import { describe, expect, test } from 'bun:test';

import {
  aggregateJudgeResults,
  ARCHITECTURE_CRITIC,
  CORRECTNESS_CRITIC,
  formatJudgeInput,
  GOAL_CRITIC,
  runJudgeEnsemble,
  SIMPLICITY_CRITIC,
  type JudgeInput,
  type JudgeProvider,
  type JudgeProviderRequest,
} from '@bond/agent-core';
import type { z } from 'zod';

describe('judge utilities', () => {
  test('formats a judge input bundle with objective checks and changed files', () => {
    const formatted = formatJudgeInput(makeJudgeInput());

    expect(formatted).toContain('# Task Prompt');
    expect(formatted).toContain('[pass] (build) build');
    expect(formatted).toContain('[fail] (runtime) endpoint');
    expect(formatted).toContain('src/example.ts');
    expect(formatted).toContain('export const value = 1;');
  });

  test('aggregates scores, flags disagreement, and applies the goal critic veto', () => {
    const result = aggregateJudgeResults([
      makeJudgeResult(ARCHITECTURE_CRITIC, 5, true),
      makeJudgeResult(SIMPLICITY_CRITIC, 4, true),
      makeJudgeResult(GOAL_CRITIC, 2, false),
      makeJudgeResult(CORRECTNESS_CRITIC, 5, true),
    ]);

    expect(result.passed).toBe(false);
    expect(result.needsHumanReview).toBe(true);
    expect(result.compositeScore).toBe(3.8);
    expect(result.blockingIssues.length).toBeGreaterThan(0);
  });

  test('deduplicates blocking issues reported through multiple failure paths', () => {
    const repeatedIssue = {
      evidence: ['objective check failed'],
      message: 'Did not satisfy the requested behavior.',
      severity: 'high' as const,
    };

    const result = aggregateJudgeResults([
      {
        confidence: 'high',
        id: ARCHITECTURE_CRITIC.id,
        issues: [],
        label: ARCHITECTURE_CRITIC.label,
        pass: true,
        passThreshold: ARCHITECTURE_CRITIC.passThreshold,
        score: 4,
        strengths: ['Modular'],
        summary: 'Acceptable.',
        weight: ARCHITECTURE_CRITIC.weight,
      },
      {
        confidence: 'high',
        id: SIMPLICITY_CRITIC.id,
        issues: [],
        label: SIMPLICITY_CRITIC.label,
        pass: true,
        passThreshold: SIMPLICITY_CRITIC.passThreshold,
        score: 4,
        strengths: ['Small'],
        summary: 'Acceptable.',
        weight: SIMPLICITY_CRITIC.weight,
      },
      {
        confidence: 'high',
        id: GOAL_CRITIC.id,
        issues: [repeatedIssue],
        label: GOAL_CRITIC.label,
        pass: false,
        passThreshold: GOAL_CRITIC.passThreshold,
        score: 2,
        strengths: [],
        summary: 'Not acceptable.',
        weight: GOAL_CRITIC.weight,
      },
      {
        confidence: 'high',
        id: CORRECTNESS_CRITIC.id,
        issues: [],
        label: CORRECTNESS_CRITIC.label,
        pass: true,
        passThreshold: CORRECTNESS_CRITIC.passThreshold,
        score: 4,
        strengths: ['Verified'],
        summary: 'Acceptable.',
        weight: CORRECTNESS_CRITIC.weight,
      },
    ]);

    expect(result.blockingIssues).toEqual([repeatedIssue]);
  });
});

describe('runJudgeEnsemble', () => {
  test('runs all critics through the provider and returns a combined verdict', async () => {
    const provider = new FakeJudgeProvider({
      [ARCHITECTURE_CRITIC.id]: { confidence: 'high', issues: [], pass: true, score: 4, strengths: ['Modular'], summary: 'Architecture is sound.' },
      [CORRECTNESS_CRITIC.id]: { confidence: 'high', issues: [], pass: true, score: 5, strengths: ['Tests passed'], summary: 'Evidence supports correctness.' },
      [SIMPLICITY_CRITIC.id]: { confidence: 'medium', issues: [], pass: true, score: 5, strengths: ['Small surface'], summary: 'Solution is concise.' },
      [GOAL_CRITIC.id]: { confidence: 'high', issues: [], pass: true, score: 4, strengths: ['Matches request'], summary: 'Goal was met.' },
    });

    const result = await runJudgeEnsemble(provider, makeJudgeInput(), [
      { model: 'judge-arch', spec: ARCHITECTURE_CRITIC },
      { model: 'judge-correct', spec: CORRECTNESS_CRITIC },
      { model: 'judge-simple', spec: SIMPLICITY_CRITIC },
      { model: 'judge-goal', spec: GOAL_CRITIC },
    ]);

    expect(result.passed).toBe(true);
    expect(result.needsHumanReview).toBe(false);
    expect(result.results).toHaveLength(4);
    expect(result.results.map((entry) => entry.id)).toEqual([
      ARCHITECTURE_CRITIC.id,
      CORRECTNESS_CRITIC.id,
      SIMPLICITY_CRITIC.id,
      GOAL_CRITIC.id,
    ]);
    expect(result.compositeScore).toBe(4.4);
    expect(result.combinedSummary).toContain('Combined verdict: pass');
  });
});

class FakeJudgeProvider implements JudgeProvider {
  constructor(
    private readonly responses: Record<
      string,
      {
        confidence: 'high' | 'low' | 'medium';
        issues: Array<{ evidence: string[]; message: string; severity: 'high' | 'low' | 'medium' }>;
        pass: boolean;
        score: number;
        strengths: string[];
        summary: string;
      }
    >,
  ) {}

  async evaluate<TSchema extends z.ZodType>(
    request: JudgeProviderRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const judgeId = inferJudgeId(request.instructions);
    const response = this.responses[judgeId];

    if (!response) {
      throw new Error(`No fake response configured for ${judgeId}`);
    }

    return request.schema.parse(response) as z.infer<TSchema>;
  }
}

function inferJudgeId(instructions: string): string {
  if (instructions.includes(ARCHITECTURE_CRITIC.label)) {
    return ARCHITECTURE_CRITIC.id;
  }

  if (instructions.includes(SIMPLICITY_CRITIC.label)) {
    return SIMPLICITY_CRITIC.id;
  }

  if (instructions.includes(CORRECTNESS_CRITIC.label)) {
    return CORRECTNESS_CRITIC.id;
  }

  return GOAL_CRITIC.id;
}

function makeJudgeInput(): JudgeInput {
  return {
    changedFiles: [
      {
        content: 'export const value = 1;',
        path: 'src/example.ts',
        summary: 'Adds the example export.',
      },
    ],
    executionSummary: 'Updated the implementation and ran focused verification.',
    finalResponse: 'Implemented the requested change and verified it.',
    objectiveChecks: [
      { category: 'build', details: 'bun run build exited 0', name: 'build', passed: true },
      { category: 'runtime', details: 'GET /api/hello returned 500', name: 'endpoint', passed: false },
    ],
    taskPrompt: 'Add a hello endpoint and verify it locally.',
  };
}

function makeJudgeResult(
  spec: typeof ARCHITECTURE_CRITIC,
  score: number,
  pass: boolean,
) {
  return {
    confidence: 'high' as const,
    id: spec.id,
    issues: pass
      ? []
      : [{ evidence: ['objective check failed'], message: 'Did not satisfy the requested behavior.', severity: 'high' as const }],
    label: spec.label,
    pass,
    passThreshold: spec.passThreshold,
    score,
    strengths: pass ? ['Good overall fit'] : [],
    summary: pass ? 'Acceptable.' : 'Not acceptable.',
    weight: spec.weight,
  };
}
