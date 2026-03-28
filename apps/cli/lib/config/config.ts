import { z } from 'zod';

import type { CliArgs } from './args.ts';
import { readCliEnv } from './env.ts';

const CliConfigSchema = z.object({
  apiKey: z.string().min(1),
  autoCompactTokenLimit: z.number().int().positive().optional(),
  baseUrl: z.string().url().optional(),
  commandTimeoutMs: z.number().int().positive().optional(),
  compactionModel: z.string().min(1).optional(),
  cwd: z.string().min(1),
  maxSteps: z.number().int().positive().optional(),
  model: z.string().min(1, 'OPENAI_MODEL or --model is required'),
  shell: z.string().min(1),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

const EvalCliConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  commandTimeoutMs: z.number().int().positive().optional(),
  cwd: z.string().min(1),
  judgeModels: z.object({
    architecture: z.string().min(1),
    correctness: z.string().min(1),
    goal: z.string().min(1),
    simplicity: z.string().min(1),
  }),
  manifestPath: z.string().min(1),
  model: z.string().min(1, 'OPENAI_MODEL or --model is required'),
  outputPath: z.string().min(1).optional(),
  runAll: z.boolean(),
  selectedCaseId: z.string().min(1).optional(),
  shell: z.string().min(1),
});

export type EvalCliConfig = z.infer<typeof EvalCliConfigSchema>;

const AutoresearchCliConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  commandTimeoutMs: z.number().int().positive().optional(),
  compactionModel: z.string().min(1).optional(),
  cwd: z.string().min(1),
  forever: z.boolean(),
  judgeModels: z.object({
    architecture: z.string().min(1),
    correctness: z.string().min(1),
    goal: z.string().min(1),
    simplicity: z.string().min(1),
  }),
  manifestPath: z.string().min(1),
  maxExperiments: z.number().int().positive(),
  model: z.string().min(1, 'OPENAI_MODEL or --model is required'),
  outputPath: z.string().min(1).optional(),
  programPath: z.string().min(1),
  resume: z.boolean(),
  shell: z.string().min(1),
  tag: z.string().min(1),
});

export type AutoresearchCliConfig = z.infer<typeof AutoresearchCliConfigSchema>;

export function createCliConfig(
  args: CliArgs,
  runtimeEnv: Record<string, string | undefined>,
  cwd: string,
): CliConfig {
  const env = readCliEnv(runtimeEnv);

  return CliConfigSchema.parse({
    apiKey: env.OPENAI_API_KEY,
    autoCompactTokenLimit: args.autoCompactTokens ?? env.OPENAI_AUTO_COMPACT_TOKENS,
    baseUrl: env.OPENAI_BASE_URL,
    commandTimeoutMs: args.timeoutMs,
    compactionModel: args.compactionModel ?? env.OPENAI_COMPACTION_MODEL,
    cwd,
    maxSteps: args.maxSteps,
    model: args.model ?? env.OPENAI_MODEL,
    shell: runtimeEnv.SHELL ?? 'sh',
  });
}

export function createEvalCliConfig(
  args: CliArgs,
  runtimeEnv: Record<string, string | undefined>,
  cwd: string,
): EvalCliConfig {
  const env = readCliEnv(runtimeEnv);
  const resolvedModel = args.model ?? env.OPENAI_MODEL;
  const sharedJudgeModel = args.judgeModel ?? env.OPENAI_JUDGE_MODEL ?? resolvedModel;

  return EvalCliConfigSchema.parse({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    commandTimeoutMs: args.timeoutMs,
    cwd,
    judgeModels: {
      architecture:
        args.judgeModelArchitecture ?? env.OPENAI_JUDGE_MODEL_ARCHITECTURE ?? sharedJudgeModel,
      correctness:
        args.judgeModelCorrectness ?? env.OPENAI_JUDGE_MODEL_CORRECTNESS ?? sharedJudgeModel,
      goal: args.judgeModelGoal ?? env.OPENAI_JUDGE_MODEL_GOAL ?? sharedJudgeModel,
      simplicity:
        args.judgeModelSimplicity ?? env.OPENAI_JUDGE_MODEL_SIMPLICITY ?? sharedJudgeModel,
    },
    manifestPath: args.manifestPath,
    model: resolvedModel,
    outputPath: args.outputPath,
    runAll: args.runAll,
    selectedCaseId: args.caseId,
    shell: runtimeEnv.SHELL ?? 'sh',
  });
}

export function createAutoresearchCliConfig(
  args: CliArgs,
  runtimeEnv: Record<string, string | undefined>,
  cwd: string,
): AutoresearchCliConfig {
  const env = readCliEnv(runtimeEnv);
  const resolvedModel = args.model ?? env.OPENAI_MODEL;
  const sharedJudgeModel = args.judgeModel ?? env.OPENAI_JUDGE_MODEL ?? resolvedModel;

  return AutoresearchCliConfigSchema.parse({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    commandTimeoutMs: args.timeoutMs,
    compactionModel: args.compactionModel ?? env.OPENAI_COMPACTION_MODEL,
    cwd,
    forever: args.forever,
    judgeModels: {
      architecture:
        args.judgeModelArchitecture ?? env.OPENAI_JUDGE_MODEL_ARCHITECTURE ?? sharedJudgeModel,
      correctness:
        args.judgeModelCorrectness ?? env.OPENAI_JUDGE_MODEL_CORRECTNESS ?? sharedJudgeModel,
      goal: args.judgeModelGoal ?? env.OPENAI_JUDGE_MODEL_GOAL ?? sharedJudgeModel,
      simplicity:
        args.judgeModelSimplicity ?? env.OPENAI_JUDGE_MODEL_SIMPLICITY ?? sharedJudgeModel,
    },
    manifestPath: args.manifestPath,
    maxExperiments: args.maxExperiments ?? 10,
    model: resolvedModel,
    outputPath: args.outputPath,
    programPath: args.programPath ?? 'program.md',
    resume: args.resume,
    shell: runtimeEnv.SHELL ?? 'sh',
    tag: args.tag ?? defaultTag(),
  });
}

function defaultTag(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
