# `@bond/agent`

Core agent runtime and prompt assembly.

- `src/session.ts`: main session loop, tool execution, and compaction-aware orchestration.
- `src/responses-client.ts`: OpenAI Responses API adapter.
- `src/responses-protocol.ts`: boundary schemas and parsing helpers for the Responses API stream/output shape.
- `src/prompt-scaffold.ts`: prompt scaffold entrypoint.
- `src/request-builder/`: small prompt-section builders for identity, repo instructions, history, execution context, tools, and user input.
- `src/memory/`: memory storage types and sqlite-backed implementation.
- `src/types.ts`: shared agent/runtime types.
- `src/index.ts`: package exports.

Tests:

- `test/agent-session.test.ts`: session and prompt behavior.
- `test/responses-client.test.ts`: Responses client shaping/parsing.
- `test/sqlite-storage.test.ts`: sqlite memory storage behavior.
