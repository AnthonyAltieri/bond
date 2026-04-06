import type { z } from 'zod';

import { aggregateJudgeResults } from './aggregate.ts';
import { createJudgeInstructions, formatJudgeInput } from './format.ts';
import {
  JudgeResultSchema,
  type JudgeEnsembleResult,
  type JudgeInput,
  type JudgeRunResult,
  type JudgeSpec,
} from './types.ts';

export interface JudgeModelConfig {
  model: string;
  spec: JudgeSpec;
}

export interface JudgeProvider {
  evaluate<TSchema extends z.ZodType>(
    request: JudgeProviderRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;
}

export interface JudgeProviderRequest<TSchema extends z.ZodType> {
  input: string;
  instructions: string;
  model: string;
  schema: TSchema;
}

export async function runJudgeEnsemble(
  provider: JudgeProvider,
  input: JudgeInput,
  judges: JudgeModelConfig[],
): Promise<JudgeEnsembleResult> {
  const renderedInput = formatJudgeInput(input);
  const results = await Promise.all(
    judges.map(async (judge) => {
      const response = await provider.evaluate({
        input: renderedInput,
        instructions: createJudgeInstructions(judge.spec),
        model: judge.model,
        schema: JudgeResultSchema,
      });

      return {
        ...response,
        id: judge.spec.id,
        label: judge.spec.label,
        passThreshold: judge.spec.passThreshold,
        weight: judge.spec.weight,
      } satisfies JudgeRunResult;
    }),
  );

  return aggregateJudgeResults(results);
}
