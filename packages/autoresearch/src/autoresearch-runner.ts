import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  AgentSession,
  type AgentSessionOptions,
  type ModelClient,
  type Tool,
} from '@bond/agent-core';
import {
  parseEvalManifest,
  runEvalManifest,
  type EvalJudgeModels,
  type EvalManifest,
  type EvalRunReport,
  type RunEvalManifestOptions,
} from '@bond/evals';
import { CORRECTNESS_CRITIC, type JudgeProvider } from '@bond/judges';
import { z } from 'zod';

const BOND_EVAL_METRIC_NAMES = [
  'overall_pass_rate',
  'avg_objective_pass_rate',
  'avg_correctness_score',
  'avg_judge_composite_score',
] as const;

const AutoresearchShellMetricSchema = z.object({
  name: z.string().min(1),
  regex: z.string().min(1),
});

const AutoresearchShellSourceSchema = z.object({
  command: z.string().min(1),
  expectExitCode: z.number().int().nonnegative().default(0),
  id: z.string().min(1),
  metrics: z.array(AutoresearchShellMetricSchema).default([]),
  required: z.boolean().default(true),
  stderrIncludes: z.array(z.string()).default([]),
  stdoutIncludes: z.array(z.string()).default([]),
  type: z.literal('shell'),
});

const AutoresearchBondEvalSourceSchema = z.object({
  caseIds: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  manifestPath: z.string().min(1),
  required: z.boolean().default(true),
  type: z.literal('bond_eval'),
});

const AutoresearchEvaluationSourceSchema = z.discriminatedUnion('type', [
  AutoresearchShellSourceSchema,
  AutoresearchBondEvalSourceSchema,
]);

const AutoresearchRankCriterionSchema = z.object({
  direction: z.enum(['higher', 'lower']),
  metric: z.string().min(1),
  sourceId: z.string().min(1),
  tolerance: z.number().nonnegative().default(0),
});

const AutoresearchManifestSchema = z
  .object({
    captureGlobs: z.array(z.string().min(1)).default([]),
    editableGlobs: z.array(z.string().min(1)).min(1),
    evaluation: z.object({
      rankOrder: z.array(AutoresearchRankCriterionSchema).min(1),
      sources: z.array(AutoresearchEvaluationSourceSchema).min(1),
    }),
    version: z.literal(1),
    webResearch: z
      .object({
        domainsAllowlist: z.array(z.string().min(1)).default([]),
        enabled: z.boolean().default(false),
        maxQueriesPerExperiment: z.number().int().positive().default(3),
        requireSourceNotes: z.boolean().default(true),
      })
      .default({
        domainsAllowlist: [],
        enabled: false,
        maxQueriesPerExperiment: 3,
        requireSourceNotes: true,
      }),
  })
  .superRefine((manifest, context) => {
    const metricsBySourceId = new Map<string, Set<string>>();

    for (const source of manifest.evaluation.sources) {
      if (metricsBySourceId.has(source.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate evaluation source id "${source.id}"`,
          path: ['evaluation', 'sources'],
        });
        continue;
      }

      metricsBySourceId.set(
        source.id,
        new Set(
          source.type === 'shell'
            ? source.metrics.map((metric) => metric.name)
            : [...BOND_EVAL_METRIC_NAMES],
        ),
      );
    }

    for (const criterion of manifest.evaluation.rankOrder) {
      const sourceMetrics = metricsBySourceId.get(criterion.sourceId);

      if (!sourceMetrics) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rankOrder references unknown source "${criterion.sourceId}"`,
          path: ['evaluation', 'rankOrder'],
        });
        continue;
      }

      if (!sourceMetrics.has(criterion.metric)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rankOrder references unknown metric "${criterion.metric}" for source "${criterion.sourceId}"`,
          path: ['evaluation', 'rankOrder'],
        });
      }
    }
  });

export type AutoresearchBondEvalSource = z.infer<typeof AutoresearchBondEvalSourceSchema>;
export type AutoresearchEvaluationSource = z.infer<typeof AutoresearchEvaluationSourceSchema>;
export type AutoresearchManifest = z.infer<typeof AutoresearchManifestSchema>;
export type AutoresearchRankCriterion = z.infer<typeof AutoresearchRankCriterionSchema>;
export type AutoresearchShellSource = z.infer<typeof AutoresearchShellSourceSchema>;

export interface AutoresearchMetricValue {
  metric: string;
  sourceId: string;
  value: number;
}

export interface AutoresearchSourceResult {
  artifacts?: string[];
  details: string;
  id: string;
  metrics: Record<string, number>;
  passed: boolean;
  required: boolean;
  type: 'bond_eval' | 'shell';
}

export interface AutoresearchExperimentRecord {
  browsed: boolean;
  changedPaths?: string[];
  commit: string;
  experiment: number;
  metrics: AutoresearchMetricValue[];
  status: 'crash' | 'discard' | 'keep';
  sourceResults: AutoresearchSourceResult[];
  summary: string;
}

export interface AutoresearchProgressEvent {
  branchName: string;
  outputDir: string;
  record: AutoresearchExperimentRecord;
  type: 'baseline-complete' | 'experiment-complete';
}

export interface AutoresearchRunResult {
  branchName: string;
  experiments: AutoresearchExperimentRecord[];
  frontierCommit: string;
  outputDir: string;
}

export interface AutoresearchRunOptions {
  browser?: WebResearcher;
  client: ModelClient;
  commandTimeoutMs?: number;
  compactionModel?: string;
  forever?: boolean;
  judgeModels: EvalJudgeModels;
  judgeProvider: JudgeProvider;
  maxExperiments?: number;
  model: string;
  onProgress?: (event: AutoresearchProgressEvent) => Promise<void> | void;
  outputDir: string;
  repoRoot: string;
  resume?: boolean;
  shell?: string;
  tag: string;
  tools: Tool[];
}

export interface WebResearchRequest {
  domainsAllowlist: string[];
  frontierSummary: string;
  maxQueries: number;
  program: string;
  recentExperiments: AutoresearchExperimentRecord[];
  repoContext: string;
}

export interface WebResearchResult {
  ideas: string[];
  notes: string;
  sources: Array<{ title: string | null; url: string }>;
}

export interface WebResearcher {
  research(request: WebResearchRequest): Promise<WebResearchResult>;
}

export interface AutoresearchDependencies {
  createSession?: (options: AgentSessionOptions) => Pick<AgentSession, 'run'>;
  git?: AutoresearchGitOps;
  loadEvalManifest?: (path: string) => Promise<string>;
  now?: () => Date;
  runEvalManifest?: (
    manifest: EvalManifest,
    options: RunEvalManifestOptions,
  ) => Promise<EvalRunReport[]>;
}

export interface AutoresearchGitOps {
  branchExists(repoRoot: string, branchName: string): Promise<boolean>;
  changedPaths(repoRoot: string): Promise<string[]>;
  commitAll(repoRoot: string, message: string): Promise<string>;
  createBranch(repoRoot: string, branchName: string): Promise<void>;
  currentBranch(repoRoot: string): Promise<string>;
  ensureCleanTrackedWorktree(repoRoot: string): Promise<void>;
  ensureExcluded(repoRoot: string, relativePath: string): Promise<void>;
  headCommit(repoRoot: string): Promise<string>;
  resetHard(repoRoot: string, ref: string): Promise<void>;
  switchBranch(repoRoot: string, branchName: string): Promise<void>;
}

export async function parseAutoresearchManifest(source: string): Promise<AutoresearchManifest> {
  return AutoresearchManifestSchema.parse(JSON.parse(source) as unknown);
}

export async function runAutoresearch(
  manifest: AutoresearchManifest,
  program: string,
  options: AutoresearchRunOptions,
  dependencies: AutoresearchDependencies = {},
): Promise<AutoresearchRunResult> {
  const normalizedManifest = AutoresearchManifestSchema.parse(manifest);
  const repoRoot = resolve(options.repoRoot);
  const outputDir = resolve(options.outputDir);
  const branchName = `autoresearch/${options.tag}`;
  const git = dependencies.git ?? new ShellGitOps(options.shell ?? 'sh');
  const records = options.resume ? await loadExperimentRecords(outputDir) : [];

  await git.ensureCleanTrackedWorktree(repoRoot);

  if (options.resume) {
    if (!(await git.branchExists(repoRoot, branchName))) {
      throw new Error(`Cannot resume missing branch "${branchName}"`);
    }

    if ((await git.currentBranch(repoRoot)) !== branchName) {
      await git.switchBranch(repoRoot, branchName);
    }
  } else {
    if (await git.branchExists(repoRoot, branchName)) {
      throw new Error(`Branch "${branchName}" already exists`);
    }

    await git.createBranch(repoRoot, branchName);
  }

  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, 'experiments'), { recursive: true });

  const relativeOutputDir = relative(repoRoot, outputDir);
  if (relativeOutputDir && !relativeOutputDir.startsWith('..')) {
    await git.ensureExcluded(repoRoot, relativeOutputDir);
  }

  let frontier = records.filter((record) => record.status === 'keep').at(-1) ?? null;

  if (!frontier) {
    const baselineRecord = await evaluateFrontier({
      browsed: false,
      changedPaths: [],
      commit: await git.headCommit(repoRoot),
      experiment: 0,
      manifest: normalizedManifest,
      options,
      repoRoot,
      summary: 'baseline',
      dependencies,
      experimentDir: join(outputDir, 'experiments', formatExperimentNumber(0)),
    });
    await persistExperiment(outputDir, baselineRecord);
    await options.onProgress?.({
      branchName,
      outputDir,
      record: baselineRecord,
      type: 'baseline-complete',
    });
    records.push(baselineRecord);
    frontier = baselineRecord;
  }

  const maxExperiments = options.forever ? Number.MAX_SAFE_INTEGER : (options.maxExperiments ?? 10);

  for (let offset = 0; offset < maxExperiments; offset += 1) {
    const experiment = records.length;
    const experimentDir = join(outputDir, 'experiments', formatExperimentNumber(experiment));
    await mkdir(experimentDir, { recursive: true });

    const baselineChangedPaths = new Set(await git.changedPaths(repoRoot));
    let browsed = false;
    let webResearch: WebResearchResult | undefined;
    let candidateCommit = frontier.commit;

    try {
      if (normalizedManifest.webResearch.enabled && options.browser) {
        webResearch = await options.browser.research({
          domainsAllowlist: normalizedManifest.webResearch.domainsAllowlist,
          frontierSummary: summarizeFrontier(frontier, normalizedManifest.evaluation.rankOrder),
          maxQueries: normalizedManifest.webResearch.maxQueriesPerExperiment,
          program,
          recentExperiments: records.slice(-5),
          repoContext: repoRoot,
        });
        browsed = true;
        await writeFile(join(experimentDir, 'web-notes.md'), formatWebNotes(webResearch));
        await writeFile(
          join(experimentDir, 'sources.json'),
          JSON.stringify(webResearch.sources, null, 2),
        );
      }

      const session = (dependencies.createSession ?? defaultCreateSession)({
        client: options.client,
        commandTimeoutMs: options.commandTimeoutMs,
        compactionModel: options.compactionModel,
        cwd: repoRoot,
        model: options.model,
        shell: options.shell,
        tools: options.tools,
      });
      const agentResult = await session.run(
        buildExperimentPrompt({
          editableGlobs: normalizedManifest.editableGlobs,
          frontier,
          program,
          recentExperiments: records.slice(-5),
          repoRoot,
          webResearch,
        }),
      );
      const summary = summarizeAgentOutput(agentResult.finalText);
      const changedPaths = (await git.changedPaths(repoRoot)).filter(
        (path) => !baselineChangedPaths.has(path),
      );

      if (changedPaths.length === 0) {
        const record: AutoresearchExperimentRecord = {
          browsed,
          changedPaths: [],
          commit: frontier.commit,
          experiment,
          metrics: [],
          sourceResults: [],
          status: 'discard',
          summary: summary || 'no changes',
        };
        await writeExperimentSummary(experimentDir, record.summary);
        await persistExperiment(outputDir, record);
        records.push(record);
        await options.onProgress?.({ branchName, outputDir, record, type: 'experiment-complete' });
        continue;
      }

      if (
        !changedPaths.every((path) => matchesEditableGlobs(path, normalizedManifest.editableGlobs))
      ) {
        await git.resetHard(repoRoot, frontier.commit);
        const record: AutoresearchExperimentRecord = {
          browsed,
          changedPaths,
          commit: frontier.commit,
          experiment,
          metrics: [],
          sourceResults: [],
          status: 'crash',
          summary: `edited paths outside editableGlobs: ${changedPaths.join(', ')}`,
        };
        await writeExperimentFailureArtifacts(experimentDir, record.summary);
        await persistExperiment(outputDir, record);
        records.push(record);
        await options.onProgress?.({ branchName, outputDir, record, type: 'experiment-complete' });
        continue;
      }

      candidateCommit = await git.commitAll(
        repoRoot,
        `autoresearch: experiment ${formatExperimentNumber(experiment)} ${summary || 'candidate'}`,
      );
      const candidateRecord = await evaluateFrontier({
        browsed,
        changedPaths,
        commit: candidateCommit,
        experiment,
        manifest: normalizedManifest,
        options,
        repoRoot,
        summary,
        dependencies,
        experimentDir,
      });

      if (!candidateRecord.sourceResults.every((result) => !result.required || result.passed)) {
        candidateRecord.status = 'discard';
        await git.resetHard(repoRoot, frontier.commit);
      } else if (
        compareMetrics(
          candidateRecord.metrics,
          frontier.metrics,
          normalizedManifest.evaluation.rankOrder,
        ) > 0
      ) {
        candidateRecord.status = 'keep';
        frontier = candidateRecord;
      } else {
        candidateRecord.status = 'discard';
        await git.resetHard(repoRoot, frontier.commit);
      }

      await persistExperiment(outputDir, candidateRecord);
      records.push(candidateRecord);
      await options.onProgress?.({
        branchName,
        outputDir,
        record: candidateRecord,
        type: 'experiment-complete',
      });
    } catch (error) {
      await git.resetHard(repoRoot, frontier.commit);
      const message = toErrorMessage(error);
      const record: AutoresearchExperimentRecord = {
        browsed,
        changedPaths: [],
        commit: candidateCommit,
        experiment,
        metrics: [],
        sourceResults: [],
        status: 'crash',
        summary: message,
      };
      await writeExperimentFailureArtifacts(experimentDir, message);
      await persistExperiment(outputDir, record);
      records.push(record);
      await options.onProgress?.({ branchName, outputDir, record, type: 'experiment-complete' });
    }
  }

  return { branchName, experiments: records, frontierCommit: frontier.commit, outputDir };
}

class AutoresearchCrashError extends Error {}

class ShellGitOps implements AutoresearchGitOps {
  constructor(private readonly shell: string) {}

  async branchExists(repoRoot: string, branchName: string): Promise<boolean> {
    const result = await execCommand(repoRoot, this.shell, [
      'git',
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ]);
    return result.exitCode === 0;
  }

  async changedPaths(repoRoot: string): Promise<string[]> {
    const result = await execCommand(
      repoRoot,
      this.shell,
      ['git', 'status', '--porcelain', '--untracked-files=all'],
      true,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git status failed');
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3))
      .map((path) => (path.includes(' -> ') ? (path.split(' -> ').at(-1) ?? path) : path));
  }

  async commitAll(repoRoot: string, message: string): Promise<string> {
    await this.runChecked(repoRoot, 'git add -A');
    await this.runChecked(repoRoot, `git commit -m ${toShellArgument(message)}`);
    return await this.headCommit(repoRoot);
  }

  async createBranch(repoRoot: string, branchName: string): Promise<void> {
    await this.runChecked(repoRoot, `git switch -c ${toShellArgument(branchName)}`);
  }

  async currentBranch(repoRoot: string): Promise<string> {
    const result = await execCommand(repoRoot, this.shell, [
      'git',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git rev-parse failed');
    }

    return result.stdout.trim();
  }

  async ensureCleanTrackedWorktree(repoRoot: string): Promise<void> {
    const result = await execCommand(repoRoot, this.shell, [
      'git',
      'status',
      '--porcelain',
      '--untracked-files=no',
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git status failed');
    }

    if (result.stdout.trim()) {
      throw new Error('autoresearch requires a clean tracked worktree');
    }
  }

  async ensureExcluded(repoRoot: string, relativePath: string): Promise<void> {
    const excludePathResult = await execCommand(repoRoot, this.shell, [
      'git',
      'rev-parse',
      '--git-path',
      'info/exclude',
    ]);

    if (excludePathResult.exitCode !== 0) {
      throw new Error(
        excludePathResult.stderr ||
          excludePathResult.stdout ||
          'git rev-parse --git-path info/exclude failed',
      );
    }

    const excludePath = resolve(repoRoot, excludePathResult.stdout.trim());
    const normalizedEntry = `${relativePath.replaceAll('\\', '/')}/`;
    let existing = '';

    try {
      existing = await readFile(excludePath, 'utf8');
    } catch {
      existing = '';
    }

    if (!existing.split('\n').includes(normalizedEntry)) {
      await mkdir(dirname(excludePath), { recursive: true });
      await appendFile(excludePath, `${normalizedEntry}\n`);
    }
  }

  async headCommit(repoRoot: string): Promise<string> {
    const result = await execCommand(repoRoot, this.shell, ['git', 'rev-parse', 'HEAD']);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git rev-parse HEAD failed');
    }

    return result.stdout.trim();
  }

  async resetHard(repoRoot: string, ref: string): Promise<void> {
    await this.runChecked(repoRoot, `git reset --hard ${toShellArgument(ref)}`);
  }

  async switchBranch(repoRoot: string, branchName: string): Promise<void> {
    await this.runChecked(repoRoot, `git switch ${toShellArgument(branchName)}`);
  }

  private async runChecked(repoRoot: string, command: string): Promise<void> {
    const result = await execCommand(repoRoot, this.shell, [this.shell, '-lc', command], true);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || command);
    }
  }
}

async function evaluateFrontier(params: {
  browsed: boolean;
  changedPaths: string[];
  commit: string;
  dependencies: AutoresearchDependencies;
  experiment: number;
  experimentDir: string;
  manifest: AutoresearchManifest;
  options: AutoresearchRunOptions;
  repoRoot: string;
  summary: string;
}): Promise<AutoresearchExperimentRecord> {
  const sourceResults: AutoresearchSourceResult[] = [];

  await mkdir(params.experimentDir, { recursive: true });

  for (const source of params.manifest.evaluation.sources) {
    if (source.type === 'shell') {
      sourceResults.push(
        await evaluateShellSource(source, {
          cwd: params.repoRoot,
          experimentDir: params.experimentDir,
          shell: params.options.shell ?? 'sh',
          timeoutMs: params.options.commandTimeoutMs,
        }),
      );
      continue;
    }

    sourceResults.push(
      await evaluateBondEvalSource(source, {
        dependencies: params.dependencies,
        experimentDir: params.experimentDir,
        options: params.options,
        repoRoot: params.repoRoot,
      }),
    );
  }

  await writeFile(
    join(params.experimentDir, 'metrics.json'),
    JSON.stringify(sourceResults, null, 2),
  );
  const capturedFiles = await captureArtifacts(params.repoRoot, params.manifest.captureGlobs);
  if (capturedFiles.length > 0) {
    await writeFile(
      join(params.experimentDir, 'captured-files.json'),
      JSON.stringify(capturedFiles, null, 2),
    );
  }
  await writeFile(join(params.experimentDir, 'summary.txt'), params.summary);

  return {
    browsed: params.browsed,
    changedPaths: params.changedPaths,
    commit: params.commit,
    experiment: params.experiment,
    metrics: flattenMetrics(sourceResults),
    sourceResults,
    status: 'keep',
    summary: params.summary,
  };
}

async function evaluateBondEvalSource(
  source: AutoresearchBondEvalSource,
  params: {
    dependencies: AutoresearchDependencies;
    experimentDir: string;
    options: AutoresearchRunOptions;
    repoRoot: string;
  },
): Promise<AutoresearchSourceResult> {
  const manifestPath = resolve(params.repoRoot, source.manifestPath);
  const manifestSource = await (params.dependencies.loadEvalManifest ?? defaultLoadText)(
    manifestPath,
  );
  const manifest = await parseEvalManifest(manifestSource);
  const reports = await (params.dependencies.runEvalManifest ?? runEvalManifest)(manifest, {
    caseIds: source.caseIds.length > 0 ? source.caseIds : undefined,
    client: params.options.client,
    commandTimeoutMs: params.options.commandTimeoutMs,
    judgeModels: params.options.judgeModels,
    judgeProvider: params.options.judgeProvider,
    model: params.options.model,
    repoRoot: params.options.repoRoot,
    shell: params.options.shell,
    tools: params.options.tools,
  });
  const reportDir = join(params.experimentDir, 'eval-reports');
  await mkdir(reportDir, { recursive: true });
  const reportPaths = await Promise.all(
    reports.map(async (report) => {
      const reportPath = join(reportDir, `${source.id}-${report.case.id}.json`);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      return relative(params.repoRoot, reportPath);
    }),
  );

  const metrics = {
    avg_correctness_score: average(
      reports
        .map((report) => readCorrectnessScore(report))
        .filter((score): score is number => score !== undefined),
    ),
    avg_judge_composite_score: average(reports.map((report) => report.judges.compositeScore)),
    avg_objective_pass_rate: average(reports.map((report) => (report.objectivePassed ? 1 : 0))),
    overall_pass_rate: average(reports.map((report) => (report.overallPassed ? 1 : 0))),
  };

  return {
    artifacts: reportPaths,
    details: `reports=${reports.length} artifacts=${reportPaths.join(',')}`,
    id: source.id,
    metrics,
    passed: reports.every((report) => report.overallPassed),
    required: source.required,
    type: 'bond_eval',
  };
}

async function evaluateShellSource(
  source: AutoresearchShellSource,
  options: { cwd: string; experimentDir: string; shell: string; timeoutMs?: number },
): Promise<AutoresearchSourceResult> {
  const child = Bun.spawn([options.shell, '-lc', source.command], {
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

  if (timedOut) {
    throw new AutoresearchCrashError(`shell source "${source.id}" timed out`);
  }

  const passed =
    exitCode === source.expectExitCode &&
    source.stdoutIncludes.every((needle) => stdout.includes(needle)) &&
    source.stderrIncludes.every((needle) => stderr.includes(needle));
  const combinedOutput = `${stdout}\n${stderr}`;
  const metrics = Object.fromEntries(
    source.metrics.map((metric) => {
      const match = combinedOutput.match(new RegExp(metric.regex, 'm'));
      const parsed = match?.[1] ?? match?.[0];
      const value = Number(parsed);

      if (!match || !Number.isFinite(value)) {
        throw new AutoresearchCrashError(
          `shell source "${source.id}" did not produce metric "${metric.name}"`,
        );
      }

      return [metric.name, value];
    }),
  );
  const artifactPaths: string[] = [];

  if (!passed || stdout.trim().length > 0 || stderr.trim().length > 0) {
    const shellDir = join(options.experimentDir, 'shell');
    await mkdir(shellDir, { recursive: true });

    if (stdout.trim().length > 0) {
      const stdoutPath = join(shellDir, `${source.id}.stdout.txt`);
      await writeFile(stdoutPath, stdout);
      artifactPaths.push(relative(options.cwd, stdoutPath));
    }

    if (stderr.trim().length > 0) {
      const stderrPath = join(shellDir, `${source.id}.stderr.txt`);
      await writeFile(stderrPath, stderr);
      artifactPaths.push(relative(options.cwd, stderrPath));
    }
  }

  return {
    artifacts: artifactPaths,
    details: formatShellSourceDetails({
      artifacts: artifactPaths,
      exitCode,
      expectedExitCode: source.expectExitCode,
      stderr,
      stdout,
    }),
    id: source.id,
    metrics,
    passed,
    required: source.required,
    type: 'shell',
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10_000) / 10_000
  );
}

function buildExperimentPrompt(params: {
  editableGlobs: string[];
  frontier: AutoresearchExperimentRecord;
  program: string;
  recentExperiments: AutoresearchExperimentRecord[];
  repoRoot: string;
  webResearch?: WebResearchResult;
}): string {
  return [
    'You are running one autoresearch experiment to improve Bond as a coding agent.',
    '',
    '# Goal',
    'Make one focused change that is likely to improve Bond on local coding evals.',
    '',
    '# Constraints',
    `- Only edit paths that match: ${params.editableGlobs.join(', ')}`,
    '- Make exactly one experimental change set, then stop.',
    '- Do not make git decisions. The orchestrator will evaluate and decide keep/discard.',
    ...buildDynamicConstraints(params.frontier, params.recentExperiments),
    '',
    '# Frontier',
    summarizeFrontier(params.frontier, []),
    '',
    '# Persistent Required Failures',
    formatPersistentFailures(params.frontier, params.recentExperiments),
    '',
    '# Stagnation Signals',
    formatStagnationSignals(params.recentExperiments),
    '',
    '# Recent Experiments',
    formatRecentExperiments(params.recentExperiments),
    '',
    '# Research Program',
    params.program,
    '',
    '# Web Research Notes',
    params.webResearch ? formatWebNotes(params.webResearch) : '(none)',
    '',
    '# Repo Context',
    `repo_root=${params.repoRoot}`,
    '',
    'When you are done, summarize the change in one short paragraph.',
  ].join('\n');
}

async function captureArtifacts(
  cwd: string,
  patterns: string[],
): Promise<Array<{ content: string; path: string }>> {
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

  return await Promise.all(
    [...matches]
      .sort((left, right) => left.localeCompare(right))
      .map(async (path) => ({ content: await readFile(join(cwd, path), 'utf8'), path })),
  );
}

function compareMetrics(
  candidateMetrics: AutoresearchMetricValue[],
  frontierMetrics: AutoresearchMetricValue[],
  rankOrder: AutoresearchRankCriterion[],
): number {
  for (const criterion of rankOrder) {
    const candidate = readMetricValue(candidateMetrics, criterion.sourceId, criterion.metric);
    const frontier = readMetricValue(frontierMetrics, criterion.sourceId, criterion.metric);
    const delta = candidate - frontier;

    if (Math.abs(delta) <= criterion.tolerance) {
      continue;
    }

    if (criterion.direction === 'higher') {
      return delta > 0 ? 1 : -1;
    }

    return delta < 0 ? 1 : -1;
  }

  return 0;
}

async function defaultLoadText(path: string): Promise<string> {
  return await readFile(path, 'utf8');
}

function defaultCreateSession(options: AgentSessionOptions): Pick<AgentSession, 'run'> {
  return new AgentSession(options);
}

async function execCommand(
  cwd: string,
  shell: string,
  command: string[] | string,
  raw = false,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Array.isArray(command)
    ? Bun.spawn(command, { cwd, stderr: 'pipe', stdout: 'pipe' })
    : Bun.spawn([shell, '-lc', command], { cwd, stderr: 'pipe', stdout: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stderr: raw ? stderr : stderr.trim(), stdout: raw ? stdout : stdout.trim() };
}

function flattenMetrics(sourceResults: AutoresearchSourceResult[]): AutoresearchMetricValue[] {
  return sourceResults.flatMap((result) =>
    Object.entries(result.metrics).map(([metric, value]) => ({
      metric,
      sourceId: result.id,
      value,
    })),
  );
}

function formatExperimentNumber(experiment: number): string {
  return String(experiment).padStart(4, '0');
}

function formatRecentExperiments(records: AutoresearchExperimentRecord[]): string {
  if (records.length === 0) {
    return '- none';
  }

  return records
    .slice(-5)
    .map((record) => {
      const primaryMetric = record.metrics[0];
      const changedPaths = readChangedPaths(record);
      const pathSummary =
        changedPaths.length > 0
          ? ` paths=${changedPaths.slice(0, 3).join(', ')}${changedPaths.length > 3 ? ', ...' : ''}`
          : '';
      return `- #${formatExperimentNumber(record.experiment)} ${record.status} ${primaryMetric ? `${primaryMetric.sourceId}.${primaryMetric.metric}=${primaryMetric.value}` : 'no-metrics'}${pathSummary} ${record.summary}`;
    })
    .join('\n');
}

function buildDynamicConstraints(
  frontier: AutoresearchExperimentRecord,
  recentExperiments: AutoresearchExperimentRecord[],
): string[] {
  const constraints: string[] = [];
  const trailingDiscards = countTrailingNonKeeps(recentExperiments);
  const hotspotPaths = summarizeHotspotPaths(recentExperiments, 2);

  if (hasRequiredFailures(frontier)) {
    constraints.push(
      '- Prioritize fixing persistent required evaluation failures before more wording or formatting polish.',
    );
  }

  if (trailingDiscards >= 3) {
    constraints.push(
      `- The last ${trailingDiscards} experiments failed to improve the frontier; change strategy instead of repeating the same micro-tweak.`,
    );
  }

  if (hotspotPaths.length > 0) {
    constraints.push(
      `- Avoid another no-gain edit centered on: ${hotspotPaths.join(', ')} unless web research provides materially new evidence.`,
    );
  }

  return constraints;
}

function countTrailingNonKeeps(records: AutoresearchExperimentRecord[]): number {
  let count = 0;

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.status === 'keep') {
      break;
    }

    count += 1;
  }

  return count;
}

function formatPersistentFailures(
  frontier: AutoresearchExperimentRecord,
  recentExperiments: AutoresearchExperimentRecord[],
): string {
  const recentFailureRecords = dedupeByExperiment([
    frontier,
    ...recentExperiments.slice(-3),
  ]).filter((record) => hasRequiredFailures(record));

  if (recentFailureRecords.length === 0) {
    return '- none';
  }

  const lines = recentFailureRecords.flatMap((record) =>
    record.sourceResults
      .filter((result) => result.required && !result.passed)
      .map(
        (result) =>
          `- #${formatExperimentNumber(record.experiment)} ${result.id}: ${result.details}`,
      ),
  );

  return lines.length > 0 ? lines.join('\n') : '- none';
}

function dedupeByExperiment(
  records: AutoresearchExperimentRecord[],
): AutoresearchExperimentRecord[] {
  const seen = new Set<number>();

  return records.filter((record) => {
    if (seen.has(record.experiment)) {
      return false;
    }

    seen.add(record.experiment);
    return true;
  });
}

function formatStagnationSignals(records: AutoresearchExperimentRecord[]): string {
  if (records.length === 0) {
    return '- none';
  }

  const trailingDiscards = countTrailingNonKeeps(records);
  const hotspotPaths = summarizeHotspotPaths(records, 2);
  const lines = [`- trailing_non_keep_experiments=${trailingDiscards}`];

  if (hotspotPaths.length > 0) {
    lines.push(`- repeated_recent_edit_hotspots=${hotspotPaths.join(', ')}`);
  }

  return lines.join('\n');
}

function hasRequiredFailures(record: AutoresearchExperimentRecord): boolean {
  return record.sourceResults.some((result) => result.required && !result.passed);
}

function summarizeHotspotPaths(
  records: AutoresearchExperimentRecord[],
  minimumCount: number,
): string[] {
  const counts = new Map<string, number>();

  for (const record of records) {
    for (const path of readChangedPaths(record)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minimumCount)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([path, count]) => `${path} (${count}x)`);
}

function formatResultsTsvRow(record: AutoresearchExperimentRecord): string {
  return [
    formatExperimentNumber(record.experiment),
    record.commit.slice(0, 7),
    record.status,
    formatMetricCell(readMetricValueByName(record.metrics, 'overall_pass_rate')),
    formatMetricCell(readMetricValueByName(record.metrics, 'avg_objective_pass_rate')),
    formatMetricCell(readMetricValueByName(record.metrics, 'avg_correctness_score')),
    sanitizeCell(record.summary),
  ].join('\t');
}

function formatMetricCell(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function formatShellSourceDetails(params: {
  artifacts: string[];
  exitCode: number;
  expectedExitCode: number;
  stderr: string;
  stdout: string;
}): string {
  const sample = summarizeShellOutput(params.stdout, params.stderr);
  const artifacts = params.artifacts.length > 0 ? ` artifacts=${params.artifacts.join(',')}` : '';

  return [
    `exit=${params.exitCode}`,
    `expected=${params.expectedExitCode}`,
    `stdout_lines=${countLines(params.stdout)}`,
    `stderr_lines=${countLines(params.stderr)}`,
    sample ? `sample=${sample}` : undefined,
    artifacts ? artifacts.trim() : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');
}

async function writeExperimentSummary(experimentDir: string, summary: string): Promise<void> {
  await writeFile(join(experimentDir, 'summary.txt'), summary);
}

async function writeExperimentFailureArtifacts(
  experimentDir: string,
  message: string,
): Promise<void> {
  await writeExperimentSummary(experimentDir, message);
  await writeFile(join(experimentDir, 'error.txt'), `${message}\n`);
}

function formatWebNotes(result: WebResearchResult): string {
  return [
    '# Notes',
    result.notes,
    '',
    '# Candidate Ideas',
    ...(result.ideas.length > 0 ? result.ideas.map((idea) => `- ${idea}`) : ['- none']),
    '',
    '# Sources',
    ...(result.sources.length > 0
      ? result.sources.map((source) => `- ${source.title ? `${source.title}: ` : ''}${source.url}`)
      : ['- none']),
  ].join('\n');
}

async function loadExperimentRecords(outputDir: string): Promise<AutoresearchExperimentRecord[]> {
  try {
    const source = await readFile(join(outputDir, 'experiments.jsonl'), 'utf8');
    return source
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AutoresearchExperimentRecord);
  } catch {
    return [];
  }
}

function matchesEditableGlobs(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}

async function persistExperiment(
  outputDir: string,
  record: AutoresearchExperimentRecord,
): Promise<void> {
  const resultsPath = join(outputDir, 'results.tsv');
  const jsonlPath = join(outputDir, 'experiments.jsonl');

  try {
    await readFile(resultsPath, 'utf8');
  } catch {
    await writeFile(
      resultsPath,
      'experiment\tcommit\tstatus\teval_pass_rate\tobjective_pass_rate\tcorrectness_score\tsummary\n',
    );
  }

  await appendFile(resultsPath, `${formatResultsTsvRow(record)}\n`);
  await appendFile(jsonlPath, `${JSON.stringify(record)}\n`);
}

function readCorrectnessScore(report: EvalRunReport): number | undefined {
  return report.judges.results.find((result) => result.id === CORRECTNESS_CRITIC.id)?.score;
}

function readMetricValue(
  metrics: AutoresearchMetricValue[],
  sourceId: string,
  metric: string,
): number {
  const value = metrics.find(
    (entry) => entry.sourceId === sourceId && entry.metric === metric,
  )?.value;

  if (value === undefined) {
    throw new Error(`Missing metric ${sourceId}.${metric}`);
  }

  return value;
}

function readMetricValueByName(
  metrics: AutoresearchMetricValue[],
  metric: string,
): number | undefined {
  return metrics.find((entry) => entry.metric === metric)?.value;
}

function readChangedPaths(record: AutoresearchExperimentRecord): string[] {
  return record.changedPaths ?? [];
}

function sanitizeCell(value: string): string {
  return value.replaceAll('\t', ' ').replaceAll('\n', ' ').trim();
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  return value.split('\n').length;
}

function summarizeShellOutput(stdout: string, stderr: string): string {
  const excerpt = [stderr, stdout]
    .flatMap((value) => value.split('\n'))
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return excerpt ? JSON.stringify(excerpt.slice(0, 200)) : '';
}

function summarizeAgentOutput(text: string): string {
  return (
    text
      .trim()
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  );
}

function summarizeFrontier(
  frontier: AutoresearchExperimentRecord,
  rankOrder: AutoresearchRankCriterion[],
): string {
  const metrics =
    rankOrder.length > 0
      ? rankOrder
          .map((criterion) => {
            const value = frontier.metrics.find(
              (metric) =>
                metric.sourceId === criterion.sourceId && metric.metric === criterion.metric,
            )?.value;
            return value === undefined
              ? null
              : `${criterion.sourceId}.${criterion.metric}=${value}`;
          })
          .filter((value): value is string => value !== null)
      : frontier.metrics.map((metric) => `${metric.sourceId}.${metric.metric}=${metric.value}`);

  return [
    `commit=${frontier.commit.slice(0, 7)}`,
    `status=${frontier.status}`,
    metrics.length > 0 ? metrics.join(', ') : 'no-metrics',
    `summary=${frontier.summary}`,
  ].join(' ');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
