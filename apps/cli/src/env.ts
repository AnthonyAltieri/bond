import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export function readCliEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv,
    server: {
      OPENAI_API_KEY: z.string().min(1),
      OPENAI_AUTO_COMPACT_TOKENS: z.coerce.number().int().positive().optional(),
      OPENAI_BASE_URL: z.string().url().optional(),
      OPENAI_COMPACTION_MODEL: z.string().min(1).optional(),
      OPENAI_MODEL: z.string().min(1).optional(),
    },
  });
}
