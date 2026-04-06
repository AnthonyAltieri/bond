import { CORRECTNESS_CRITIC, GOAL_CRITIC } from './specs.ts';
import type { JudgeEnsembleResult, JudgeIssue, JudgeRunResult } from './types.ts';

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
