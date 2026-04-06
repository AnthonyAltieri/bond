import type {
  ChangedFileArtifact,
  JudgeInput,
  JudgeSpec,
  ObjectiveCheckArtifact,
} from './types.ts';

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
