import { z } from 'zod';

export const judgeConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const judgeIssueSeveritySchema = z.enum(['low', 'medium', 'high']);
export const objectiveCheckCategorySchema = z.enum([
  'build',
  'content',
  'final_response',
  'runtime',
  'test',
  'other',
]);

export const judgeIssueSchema = z.object({
  evidence: z.array(z.string()).max(5),
  message: z.string().min(1),
  severity: judgeIssueSeveritySchema,
});

export const judgeResultSchema = z.object({
  confidence: judgeConfidenceSchema,
  issues: z.array(judgeIssueSchema).max(10),
  pass: z.boolean(),
  score: z.int().min(1).max(5),
  strengths: z.array(z.string()).max(5),
  summary: z.string().min(1),
});

export type JudgeConfidence = z.infer<typeof judgeConfidenceSchema>;
export type JudgeIssue = z.infer<typeof judgeIssueSchema>;
export type JudgeIssueSeverity = z.infer<typeof judgeIssueSeveritySchema>;
export type JudgeResponse = z.infer<typeof judgeResultSchema>;
export type ObjectiveCheckCategory = z.infer<typeof objectiveCheckCategorySchema>;

export interface ChangedFileArtifact {
  content?: string;
  path: string;
  summary?: string;
}

export interface ObjectiveCheckArtifact {
  category: ObjectiveCheckCategory;
  details: string;
  name: string;
  passed: boolean;
}

export interface JudgeInput {
  changedFiles: ChangedFileArtifact[];
  executionSummary?: string;
  finalResponse: string;
  objectiveChecks: ObjectiveCheckArtifact[];
  taskPrompt: string;
}

export interface JudgeSpec {
  focusAreas: string[];
  id: string;
  label: string;
  passThreshold: number;
  rubric: string[];
  weight: number;
}

export interface JudgeRunResult extends JudgeResponse {
  id: string;
  label: string;
  passThreshold: number;
  weight: number;
}

export interface JudgeEnsembleResult {
  blockingIssues: JudgeIssue[];
  combinedSummary: string;
  compositePercent: number;
  compositeScore: number;
  needsHumanReview: boolean;
  passed: boolean;
  results: JudgeRunResult[];
}

export const ARCHITECTURE_CRITIC: JudgeSpec = {
  focusAreas: [
    'Separation of concerns',
    'Fit with repository conventions',
    'Maintainability and extension points',
    'Avoidance of brittle or tangled coupling',
  ],
  id: 'architecture_critic',
  label: 'Architecture Critic',
  passThreshold: 3,
  rubric: [
    'Prefer modular changes that match existing abstractions.',
    'Penalize hidden coupling, leaky interfaces, and duplicated logic.',
    'Reward solutions that make future evaluation or provider expansion easier.',
  ],
  weight: 0.25,
};

export const SIMPLICITY_CRITIC: JudgeSpec = {
  focusAreas: [
    'Minimal code surface area',
    'Avoidance of unnecessary abstractions',
    'Clarity over cleverness',
    'Scope discipline',
  ],
  id: 'simplicity_critic',
  label: 'Simplicity Critic',
  passThreshold: 3,
  rubric: [
    'Penalize over-engineering, unnecessary indirection, and inflated code size.',
    'Reward the smallest correct solution that remains readable and testable.',
    'Treat speculative complexity as a negative unless it clearly enables the stated goal.',
  ],
  weight: 0.15,
};

export const GOAL_CRITIC: JudgeSpec = {
  focusAreas: [
    'Faithfulness to the user prompt',
    'Behavioral correctness relative to requested outcomes',
    'Completeness of the implementation',
    'Alignment with objective verification evidence',
  ],
  id: 'goal_critic',
  label: 'Goal Critic',
  passThreshold: 4,
  rubric: [
    'Use the objective verification results as ground truth when available.',
    'Penalize missing requested behavior, ignored constraints, or mismatched outputs.',
    'Fail harshly when the final result does not satisfy the prompt even if the code quality is otherwise high.',
  ],
  weight: 0.35,
};

export const CORRECTNESS_CRITIC: JudgeSpec = {
  focusAreas: [
    'Use of tests and runtime checks as behavioral evidence',
    'Alignment between observed verification results and claimed correctness',
    'Likelihood the delivered solution actually works for the requested behavior',
    'Confidence calibration when evidence is weak or missing',
  ],
  id: 'correctness_critic',
  label: 'Correctness Critic',
  passThreshold: 4,
  rubric: [
    'Treat test and runtime verification results as the strongest correctness evidence when they are available.',
    'Penalize solutions that claim success without meaningful verification, especially when behavior is complex or executable.',
    'If tests or runtime checks fail, score correctness harshly even if the code looks plausible.',
  ],
  weight: 0.25,
};

export const DEFAULT_JUDGE_SPECS = [
  ARCHITECTURE_CRITIC,
  SIMPLICITY_CRITIC,
  GOAL_CRITIC,
  CORRECTNESS_CRITIC,
];

export function aggregateJudgeResults(results: JudgeRunResult[]): JudgeEnsembleResult {
  if (results.length === 0) {
    throw new Error('At least one judge result is required');
  }

  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);

  if (totalWeight <= 0) {
    throw new Error('Judge weights must sum to a positive number');
  }

  const compositeScore =
    results.reduce((sum, result) => sum + result.score * result.weight, 0) / totalWeight;
  const highestScore = Math.max(...results.map((result) => result.score));
  const lowestScore = Math.min(...results.map((result) => result.score));
  const needsHumanReview = highestScore - lowestScore >= 2;
  const goalCritic = results.find((result) => result.id === GOAL_CRITIC.id);
  const goalCriticFailed = goalCritic !== undefined && goalCritic.score <= 2;
  const correctnessCritic = results.find((result) => result.id === CORRECTNESS_CRITIC.id);
  const correctnessCriticFailed = correctnessCritic !== undefined && correctnessCritic.score <= 2;
  const thresholdFailures = results.filter((result) => result.score < result.passThreshold);
  const explicitFailures = results.filter((result) => !result.pass);
  const blockingIssues = dedupeJudgeIssues([
    ...(goalCriticFailed ? (goalCritic?.issues ?? []) : []),
    ...(correctnessCriticFailed ? (correctnessCritic?.issues ?? []) : []),
    ...collectBlockingIssues(results),
  ]);
  const passed =
    !goalCriticFailed &&
    !correctnessCriticFailed &&
    thresholdFailures.length === 0 &&
    explicitFailures.length === 0;

  return {
    blockingIssues,
    combinedSummary: summarizeJudgeResults(results, compositeScore, needsHumanReview, passed),
    compositePercent: Math.round(((compositeScore - 1) / 4) * 100),
    compositeScore: roundToTwoDecimals(compositeScore),
    needsHumanReview,
    passed,
    results,
  };
}

export function createJudgeInstructions(spec: JudgeSpec): string {
  return [
    `You are the ${spec.label}.`,
    'Evaluate the supplied implementation artifacts and return strict JSON that matches the provided schema.',
    `Your scoring scale is 1 to 5, and scores below ${spec.passThreshold} are considered failing for this critic.`,
    'Use objective verification results as stronger evidence than optimistic assistant claims.',
    'Do not suggest code changes. Only evaluate the delivered result.',
    'Focus areas:',
    ...spec.focusAreas.map((focusArea) => `- ${focusArea}`),
    'Rubric:',
    ...spec.rubric.map((line) => `- ${line}`),
  ].join('\n');
}

export function formatJudgeInput(input: JudgeInput): string {
  return [
    '# Task Prompt',
    input.taskPrompt,
    '',
    '# Final Response',
    input.finalResponse || '(empty)',
    '',
    '# Objective Checks',
    ...formatObjectiveChecks(input.objectiveChecks),
    '',
    '# Execution Summary',
    input.executionSummary?.trim() || '(none)',
    '',
    '# Changed Files',
    ...formatChangedFiles(input.changedFiles),
  ].join('\n');
}

function collectBlockingIssues(results: JudgeRunResult[]): JudgeIssue[] {
  return results.flatMap((result) =>
    result.issues.filter(
      (issue) => issue.severity === 'high' || result.score < result.passThreshold,
    ),
  );
}

function dedupeJudgeIssues(issues: JudgeIssue[]): JudgeIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = JSON.stringify([issue.severity, issue.message, issue.evidence]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatChangedFiles(changedFiles: ChangedFileArtifact[]): string[] {
  if (changedFiles.length === 0) {
    return ['- None supplied'];
  }

  return changedFiles.flatMap((file) => {
    const lines = [`- ${file.path}`];

    if (file.summary) {
      lines.push(`  summary: ${file.summary}`);
    }

    if (file.content) {
      lines.push('  content:');
      lines.push(...indentBlock(file.content, '    '));
    }

    return lines;
  });
}

function formatObjectiveChecks(checks: ObjectiveCheckArtifact[]): string[] {
  if (checks.length === 0) {
    return ['- None supplied'];
  }

  return checks.map(
    (check) =>
      `- [${check.passed ? 'pass' : 'fail'}] (${check.category}) ${check.name}: ${check.details}`,
  );
}

function indentBlock(text: string, prefix: string): string[] {
  return text.split('\n').map((line) => `${prefix}${line}`);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizeJudgeResults(
  results: JudgeRunResult[],
  compositeScore: number,
  needsHumanReview: boolean,
  passed: boolean,
): string {
  const resultSummary = results.map((result) => `${result.label} ${result.score}/5`).join(', ');
  const reviewNote = needsHumanReview
    ? ' Critics disagree materially; human review is recommended.'
    : '';
  return `Combined verdict: ${passed ? 'pass' : 'fail'} at ${roundToTwoDecimals(compositeScore)}/5. ${resultSummary}.${reviewNote}`;
}
