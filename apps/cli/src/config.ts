import { z } from 'zod';

import type { CliArgs } from './args.ts';
import { readCliEnv } from './env.ts';

const cliConfigSchema = z.object({
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

export type CliConfig = z.infer<typeof cliConfigSchema>;

export function createCliConfig(
  args: CliArgs,
  runtimeEnv: Record<string, string | undefined>,
  cwd: string,
): CliConfig {
  const env = readCliEnv(runtimeEnv);

  return cliConfigSchema.parse({
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
