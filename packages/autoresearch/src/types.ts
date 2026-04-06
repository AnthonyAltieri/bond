import type { AgentSessionOptions, ModelClient, Tool } from '@bond/agent';
import type {
  EvalJudgeModels,
  EvalManifest,
  EvalRunReport,
  RunEvalManifestOptions,
} from '@bond/evals';
import type { JudgeProvider } from '@bond/judges';
import { z } from 'zod';

export const BondEvalMetricNames = [
  'overall_pass_rate',
  'avg_objective_pass_rate',
  'avg_correctness_score',
  'avg_judge_composite_score',
] as const;

export const AutoresearchShellMetricSchema = z.object({
  name: z.string().min(1),
  regex: z.string().min(1),
});

export const AutoresearchShellSourceSchema = z.object({
  command: z.string().min(1),
  expectExitCode: z.number().int().nonnegative().default(0),
  id: z.string().min(1),
  metrics: z.array(AutoresearchShellMetricSchema).default([]),
  required: z.boolean().default(true),
  stderrIncludes: z.array(z.string()).default([]),
  stdoutIncludes: z.array(z.string()).default([]),
  type: z.literal('shell'),
});

export const AutoresearchBondEvalSourceSchema = z.object({
  caseIds: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  manifestPath: z.string().min(1),
  required: z.boolean().default(true),
  type: z.literal('bond_eval'),
});

export const AutoresearchEvaluationSourceSchema = z.discriminatedUnion('type', [
  AutoresearchShellSourceSchema,
  AutoresearchBondEvalSourceSchema,
]);

export const AutoresearchRankCriterionSchema = z.object({
  direction: z.enum(['higher', 'lower']),
  metric: z.string().min(1),
  sourceId: z.string().min(1),
  tolerance: z.number().nonnegative().default(0),
});

export const AutoresearchManifestSchema = z
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
            : [...BondEvalMetricNames],
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
  createSession?: (
    options: AgentSessionOptions,
  ) => Pick<{ run: (prompt: string) => Promise<{ finalText: string }> }, 'run'>;
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
