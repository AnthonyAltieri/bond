# `@bond/judges`

Judge specs, result aggregation, and provider adapters for eval scoring.

- `src/types.ts`: judge schemas and shared types.
- `src/specs.ts`: built-in critic definitions.
- `src/aggregate.ts`: score aggregation and blocking-issue reduction.
- `src/format.ts`: prompt/input formatting helpers for judges.
- `src/runner.ts`: judge ensemble execution.
- `src/openai-provider.ts`: OpenAI-backed judge provider.
- `src/index.ts`: package exports.

Tests:

- `test/judge-runner.test.ts`: aggregation, formatting, and runner behavior.
