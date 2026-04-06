# `@bond/tools`

Local tool definitions and supporting services for the agent runtime.

- `src/toolsets/`: package-level toolset assembly.
- `src/shared/`: common JSON and workspace helpers.
- `src/types.ts`: tool contracts and execution types.
- `src/services.ts`: shared runtime services used by tools.
- `src/agents.ts`: child-agent lifecycle tools.
- `src/exec.ts`: persistent exec session tools.
- `src/exec-manager.ts`: in-memory exec session runtime used by the exec tools.
- `src/apply-patch.ts`: patch-based file editing.
- `src/view-image.ts`: local image inspection.
- `src/mcp.ts`: MCP resource listing/reading tools.
- `src/parallel.ts`: safe parallel wrapper for direct tool calls.
- `src/plan.ts`: plan update tools.
- `src/shell.ts`: workspace shell tool.
- `src/index.ts`: package exports.

Tests:

- `test/`: focused coverage for each tool family and toolset assembly.
