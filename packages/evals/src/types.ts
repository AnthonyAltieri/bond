import type {
  AgentToolTraceEntry,
  ModelClient,
  PlanSnapshot,
  ResponseInputItem,
  Tool,
} from '@bond/agent';
import type {
  ChangedFileArtifact,
  JudgeEnsembleResult,
  ObjectiveCheckCategory,
  JudgeProvider,
} from '@bond/judges';
import { ObjectiveCheckCategorySchema } from '@bond/judges';
import type { ToolServices } from '@bond/tools';
import { z } from 'zod';

export const EvalFinalResponseMatcherSchema = z.object({
  type: z.enum(['contains', 'equals']),
  value: z.string().min(1),
});

export const EvalObjectiveCheckSpecSchema = z.object({
  category: ObjectiveCheckCategorySchema.default('other'),
  command: z.string().min(1),
  expectExitCode: z.number().int().nonnegative().default(0),
  name: z.string().min(1),
  stderrIncludes: z.array(z.string()).default([]),
  stdoutIncludes: z.array(z.string()).default([]),
});

export const EvalCaseSchema = z.object({
  capturePaths: z.array(z.string().min(1)).default([]),
  commandTimeoutMs: z.number().int().positive().optional(),
  description: z.string().min(1),
  finalResponse: EvalFinalResponseMatcherSchema.optional(),
  id: z.string().min(1),
  maxSteps: z.number().int().positive().optional(),
  minSteps: z.number().int().positive().optional(),
  objectiveChecks: z.array(EvalObjectiveCheckSpecSchema).default([]),
  prompt: z.string().min(1),
  requiredTools: z.array(z.string().min(1)).default([]),
  toolUsageChecks: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          name: z.string().min(1),
          tools: z.array(z.string().min(1)).min(1),
          type: z.literal('all_of'),
        }),
        z.object({
          name: z.string().min(1),
          tools: z.array(z.string().min(1)).min(1),
          type: z.literal('any_of'),
        }),
        z.object({
          minCalls: z.number().int().positive(),
          name: z.string().min(1),
          tool: z.string().min(1),
          type: z.literal('min_calls'),
        }),
      ]),
    )
    .default([]),
  workingDirectoryMode: z.enum(['repo', 'temp-empty']).default('repo'),
});

export const EvalManifestSchema = z.object({
  cases: z.array(EvalCaseSchema).min(1),
  version: z.literal(1),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalCaseInput = z.input<typeof EvalCaseSchema>;
export type EvalFinalResponseMatcher = z.infer<typeof EvalFinalResponseMatcherSchema>;
export type EvalManifest = z.infer<typeof EvalManifestSchema>;
export type EvalManifestInput = z.input<typeof EvalManifestSchema>;
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
  runId: string;
  startedAt: string;
  status: {
    compactionsUsed: number;
    plan?: PlanSnapshot;
    stopReason: 'completed' | 'max_steps';
    stepsUsed: number;
    toolTrace: AgentToolTraceEntry[];
    toolUsage: EvalToolUsageSummary;
  };
}

export interface EvalToolUsageSummary {
  callCounts: Record<string, number>;
  usedTools: string[];
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
  toolServices?: Partial<ToolServices>;
  tools: Tool[];
}

export interface RunEvalManifestOptions extends RunEvalCaseOptions {
  caseIds?: string[];
}

export interface ToolUsageInput {
  inputItems: ResponseInputItem[];
  toolTrace: AgentToolTraceEntry[];
}
