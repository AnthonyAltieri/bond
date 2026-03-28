import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { AgentSession, type ModelClient, type PlanSnapshot, type Tool } from '@bond/agent';
import {
  ARCHITECTURE_CRITIC,
  CORRECTNESS_CRITIC,
  GOAL_CRITIC,
  SIMPLICITY_CRITIC,
  type ChangedFileArtifact,
  type JudgeEnsembleResult,
  type ObjectiveCheckCategory,
  objectiveCheckCategorySchema,
  type JudgeProvider,
  runJudgeEnsemble,
} from '@bond/judges';
import { z } from 'zod';

const DEFAULT_TEMP_ROOT = '/tmp';

const EvalFinalResponseMatcherSchema = z.object({
  type: z.enum(['contains', 'equals']),
  value: z.string().min(1),
});

const EvalObjectiveCheckSpecSchema = z.object({
  category: objectiveCheckCategorySchema.default('other'),
  command: z.string().min(1),
  expectExitCode: z.number().int().nonnegative().default(0),
  name: z.string().min(1),
  stderrIncludes: z.array(z.string()).default([]),
  stdoutIncludes: z.array(z.string()).default([]),
});

const EvalCaseSchema = z.object({
  capturePaths: z.array(z.string().min(1)).default([]),
  commandTimeoutMs: z.number().int().positive().optional(),
  description: z.string().min(1),
  finalResponse: EvalFinalResponseMatcherSchema.optional(),
  id: z.string().min(1),
  maxSteps: z.number().int().positive().optional(),
  objectiveChecks: z.array(EvalObjectiveCheckSpecSchema).default([]),
  prompt: z.string().min(1),
  workingDirectoryMode: z.enum(['repo', 'temp-empty']).default('repo'),
});

const EvalManifestSchema = z.object({
  cases: z.array(EvalCaseSchema).min(1),
  version: z.literal(1),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalFinalResponseMatcher = z.infer<typeof EvalFinalResponseMatcherSchema>;
export type EvalManifest = z.infer<typeof EvalManifestSchema>;
export type EvalObjectiveCheckSpec = z.infer<typeof EvalObjectiveCheckSpecSchema>;

export interface EvalJudgeModels {
  architecture: string;
  correctness: string;
  goal: string;
  simplicity: string;
}

export interface EvalObjectiveCheckResult {
  category: ObjectiveCheckCategory;
  command: string;
  details: string;
  exitCode: number;
  name: string;
  passed: boolean;
  stderr: string;
  stdout: string;
}

export interface EvalRunReport {
  capturedFiles: ChangedFileArtifact[];
  case: {
    description: string;
    id: string;
    prompt: string;
    workingDirectory: string;
    workingDirectoryMode: EvalCase['workingDirectoryMode'];
  };
  durationMs: number;
  finalResponse: string;
  judgePassed: boolean;
  judges: JudgeEnsembleResult;
  model: string;
  objectiveChecks: EvalObjectiveCheckResult[];
  objectivePassed: boolean;
  overallPassed: boolean;
  startedAt: string;
  status: {
    compactionsUsed: number;
    plan?: PlanSnapshot;
    stopReason: 'completed' | 'max_steps';
    stepsUsed: number;
  };
}

export interface RunEvalCaseOptions {
  client: ModelClient;
  commandTimeoutMs?: number;
  judgeModels: EvalJudgeModels;
  judgeProvider: JudgeProvider;
  model: string;
  repoRoot: string;
  shell?: string;
  tempRoot?: string;
  tools: Tool[];
}

export interface RunEvalManifestOptions extends RunEvalCaseOptions {
  caseIds?: string[];
}

export async function parseEvalManifest(source: string): Promise<EvalManifest> {
  return EvalManifestSchema.parse(JSON.parse(source) as unknown);
}

export async function runEvalManifest(
  manifest: EvalManifest,
  options: RunEvalManifestOptions,
): Promise<EvalRunReport[]> {
  const normalizedManifest = EvalManifestSchema.parse(manifest);
  const selectedCases =
    options.caseIds && options.caseIds.length > 0
      ? normalizedManifest.cases.filter((entry) => options.caseIds?.includes(entry.id))
      : normalizedManifest.cases;

  if (selectedCases.length === 0) {
    throw new Error('No eval cases matched the requested selection');
  }

  const reports: EvalRunReport[] = [];

  for (const entry of selectedCases) {
    reports.push(await runEvalCase(entry, options));
  }

  return reports;
}

export async function runEvalCase(
  entry: EvalCase,
  options: RunEvalCaseOptions,
): Promise<EvalRunReport> {
  const normalizedEntry = EvalCaseSchema.parse(entry);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const shell = options.shell ?? 'sh';
  const baseWorkspace =
    normalizedEntry.workingDirectoryMode === 'repo'
      ? resolve(options.repoRoot)
      : await createTempDir(options.tempRoot ?? DEFAULT_TEMP_ROOT);

  try {
    const session = new AgentSession({
      client: options.client,
      commandTimeoutMs: normalizedEntry.commandTimeoutMs ?? options.commandTimeoutMs,
      cwd: baseWorkspace,
      maxSteps: normalizedEntry.maxSteps,
      model: options.model,
      shell,
      tools: options.tools,
    });
    const agentResult = await session.run(normalizedEntry.prompt);
    const finalResponseCheck = evaluateFinalResponse(
      normalizedEntry.finalResponse,
      agentResult.finalText,
    );
    const objectiveCheckResults = await Promise.all(
      normalizedEntry.objectiveChecks.map((check) =>
        runObjectiveCheck(check, {
          cwd: baseWorkspace,
          shell,
          timeoutMs: normalizedEntry.commandTimeoutMs ?? options.commandTimeoutMs,
        }),
      ),
    );
    const allObjectiveChecks = finalResponseCheck
      ? [finalResponseCheck, ...objectiveCheckResults]
      : objectiveCheckResults;
    const capturedFiles = await captureArtifacts(baseWorkspace, normalizedEntry.capturePaths);
    const judges = await runJudgeEnsemble(
      options.judgeProvider,
      {
        changedFiles: capturedFiles,
        executionSummary: buildExecutionSummary(baseWorkspace, normalizedEntry, agentResult),
        finalResponse: agentResult.finalText,
        objectiveChecks: allObjectiveChecks.map((check) => ({
          category: check.category,
          details: check.details,
          name: check.name,
          passed: check.passed,
        })),
        taskPrompt: normalizedEntry.prompt,
      },
      [
        { model: options.judgeModels.architecture, spec: ARCHITECTURE_CRITIC },
        { model: options.judgeModels.simplicity, spec: SIMPLICITY_CRITIC },
        { model: options.judgeModels.goal, spec: GOAL_CRITIC },
        { model: options.judgeModels.correctness, spec: CORRECTNESS_CRITIC },
      ],
    );
    const objectivePassed = allObjectiveChecks.every((check) => check.passed);

    return {
      capturedFiles,
      case: {
        description: normalizedEntry.description,
        id: normalizedEntry.id,
        prompt: normalizedEntry.prompt,
        workingDirectory: baseWorkspace,
        workingDirectoryMode: normalizedEntry.workingDirectoryMode,
      },
      durationMs: Date.now() - startedMs,
      finalResponse: agentResult.finalText,
      judgePassed: judges.passed,
      judges,
      model: options.model,
      objectiveChecks: allObjectiveChecks,
      objectivePassed,
      overallPassed: objectivePassed && judges.passed,
      startedAt,
      status: {
        compactionsUsed: agentResult.compactionsUsed,
        plan: agentResult.plan,
        stepsUsed: agentResult.stepsUsed,
        stopReason: agentResult.stopReason,
      },
    };
  } finally {
    if (normalizedEntry.workingDirectoryMode === 'temp-empty') {
      await rm(baseWorkspace, { force: true, recursive: true });
    }
  }
}

export function formatEvalReportSummary(report: EvalRunReport): string {
  return [
    `eval:${report.case.id}`,
    `objective=${report.objectivePassed ? 'pass' : 'fail'}`,
    `judges=${report.judgePassed ? 'pass' : 'fail'}`,
    `overall=${report.overallPassed ? 'pass' : 'fail'}`,
    `score=${report.judges.compositeScore}/5`,
    `architecture=${readJudgeScore(report, ARCHITECTURE_CRITIC.id)}`,
    `simplicity=${readJudgeScore(report, SIMPLICITY_CRITIC.id)}`,
    `goal=${readJudgeScore(report, GOAL_CRITIC.id)}`,
    `correctness=${readJudgeScore(report, CORRECTNESS_CRITIC.id)}`,
    report.judges.needsHumanReview ? 'needs_human_review=yes' : 'needs_human_review=no',
  ].join(' ');
}

export async function writeEvalReport(path: string, report: EvalRunReport): Promise<void> {
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(`${resolvedPath}`, JSON.stringify(report, null, 2));
}

function buildExecutionSummary(
  cwd: string,
  entry: EvalCase,
  result: { compactionsUsed: number; stopReason: 'completed' | 'max_steps'; stepsUsed: number },
): string {
  return [
    `workspace=${cwd}`,
    `workingDirectoryMode=${entry.workingDirectoryMode}`,
    `stopReason=${result.stopReason}`,
    `stepsUsed=${result.stepsUsed}`,
    `compactionsUsed=${result.compactionsUsed}`,
  ].join('\n');
}

async function captureArtifacts(cwd: string, patterns: string[]): Promise<ChangedFileArtifact[]> {
  const matches = new Set<string>();

  for (const pattern of patterns) {
    for await (const match of new Bun.Glob(pattern).scan({
      absolute: false,
      cwd,
      onlyFiles: true,
    })) {
      matches.add(match);
    }
  }

  const artifacts = await Promise.all(
    [...matches]
      .sort((left, right) => left.localeCompare(right))
      .map(async (relativePath) => ({
        content: await readFile(join(cwd, relativePath), 'utf8'),
        path: relativePath,
      })),
  );

  return artifacts;
}

async function createTempDir(tempRoot: string): Promise<string> {
  const directory = join(
    resolve(tempRoot),
    `bond-eval-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(directory, { recursive: true });
  return directory;
}

function evaluateFinalResponse(
  matcher: EvalFinalResponseMatcher | undefined,
  finalResponse: string,
): EvalObjectiveCheckResult | undefined {
  if (!matcher) {
    return undefined;
  }

  const passed =
    matcher.type === 'equals'
      ? finalResponse.trim() === matcher.value
      : finalResponse.includes(matcher.value);

  return {
    command: `final_response.${matcher.type}`,
    category: 'final_response',
    details: `Expected final response to ${matcher.type} "${matcher.value}"`,
    exitCode: passed ? 0 : 1,
    name: 'final response',
    passed,
    stderr: '',
    stdout: finalResponse,
  };
}

async function runObjectiveCheck(
  check: EvalObjectiveCheckSpec,
  options: { cwd: string; shell: string; timeoutMs?: number },
): Promise<EvalObjectiveCheckResult> {
  const child = Bun.spawn([options.shell, '-lc', check.command], {
    cwd: options.cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let timedOut = false;
  const timer =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  const passed =
    !timedOut &&
    exitCode === check.expectExitCode &&
    check.stdoutIncludes.every((needle) => stdout.includes(needle)) &&
    check.stderrIncludes.every((needle) => stderr.includes(needle));

  return {
    category: check.category,
    command: check.command,
    details: timedOut
      ? `timed_out after=${options.timeoutMs}ms exit=${exitCode} expected=${check.expectExitCode}`
      : `exit=${exitCode} expected=${check.expectExitCode}`,
    exitCode,
    name: check.name,
    passed,
    stderr,
    stdout,
  };
}

function readJudgeScore(report: EvalRunReport, judgeId: string): string {
  const match = report.judges.results.find((entry) => entry.id === judgeId);
  return match ? String(match.score) : 'n/a';
}
