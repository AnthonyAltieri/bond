# `@bond/evals`

Manifest-driven eval runner for local coding tasks.

- `src/runner.ts`: eval execution, objective checks, artifact capture, and report generation.
- `src/types.ts`: eval manifest/report schemas and shared runner types.
- `src/index.ts`: package exports.

Tests:

- `test/eval-runner.test.ts`: runner behavior and built-in checks.
- `test/openai-evals.test.ts`: network-backed live eval integration.
