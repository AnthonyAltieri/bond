# Agentic CLI Plan

## Goal
Build the simplest useful agentic coding CLI in a Bun monorepo. The first version should accept a prompt, call one model provider, execute one local tool, and loop until it can answer or reaches a clear stopping limit.

## Success Criteria
- [x] `bun run cli -- "show me the repo files"` works end-to-end from the terminal.
- [x] The CLI supports one-shot mode and a minimal interactive mode.
- [x] The agent can call a `shell` tool, receive stdout/stderr/exit code, and use that result in a follow-up model step.
- [x] The agent loop has hard limits for max iterations, command timeout, and output size.
- [x] The repo is organized as a monorepo and uses Bun workspaces.
- [x] Formatting uses `oxfmt` and linting uses `oxlint`.
- [x] The project has focused tests for the loop, tool execution, and a smoke test for the CLI.
- [x] The README explains setup, environment variables, and one example session.

## Simplicity Rules
- [x] Use TypeScript with Bun only. No build step was added.
- [x] Support exactly one provider in v1 through a tiny client interface.
- [x] Ship exactly one built-in tool in v1: `shell`.
- [x] Keep all agent state in memory. No persistence, resume, or transcript storage.
- [x] No TUI, no plugin system, no MCP, no approvals UI, no sandboxing layer, and no multi-agent flows.
- [x] Prefer plain objects and small files over frameworks or deep abstractions.

## Assumptions And Constraints
- [x] v1 is for trusted local use in the current working directory.
- [x] The runtime target is Bun on macOS/Linux.
- [x] The provider is OpenAI-compatible and wrapped directly with `fetch`.
- [x] The CLI remains understandable by reading a small number of files in one sitting.

## Repo Shape
- [x] `package.json`
- [x] `bunfig.toml`
- [x] `tsconfig.base.json`
- [x] root Oxc config for formatting and linting
- [x] `apps/cli`
- [x] `packages/agent-core`

## Package Responsibilities
### `apps/cli`
- [x] Parse args and environment variables.
- [x] Start one-shot mode when a prompt is passed.
- [x] Start a simple REPL when no prompt is passed.
- [x] Stream model text to stdout and print tool activity plainly.

### `packages/agent-core`
- [x] Define message types, tool types, and run options.
- [x] Implement the provider client.
- [x] Implement the `shell` tool around `Bun.spawn`.
- [x] Implement the agent loop: model step, tool step, repeat, stop.
- [x] Normalize provider responses so the rest of the code does not care about wire format details.

## Phase Plan
### Phase 1: Workspace Scaffold
- [x] Create Bun workspace config at the root.
- [x] Add root scripts for `dev`, `test`, `lint`, and `format`.
- [x] Add shared TypeScript config.
- [x] Add Oxc config and verify it runs against both workspace packages.

### Phase 2: Core Types And Provider
- [x] Create a tiny `ModelClient` interface with one method for a turn.
- [x] Implement one provider client only.
- [x] Define the smallest useful message schema: `system`, `user`, `assistant`, `tool`.
- [x] Define a provider result shape that can return text, tool calls, or both.

### Phase 3: Tooling Layer
- [x] Implement the `shell` tool with `command`, `cwd`, and optional `timeoutMs`.
- [x] Return structured results: `stdout`, `stderr`, `exitCode`, `timedOut`.
- [x] Cap output length to avoid runaway context growth.
- [x] Keep execution scoped to the current workspace by default.

### Phase 4: Agent Loop
- [x] Add a fixed system prompt that explains the tool and the operating rules.
- [x] Run a bounded loop: ask model, execute tools, append results, repeat.
- [x] Stop when the model returns a final answer with no tool calls.
- [x] Enforce max step count to prevent infinite loops.
- [x] Surface provider and tool errors without crashing the process.

### Phase 5: CLI
- [x] Add a top-level CLI command.
- [x] Support `bun run cli -- "<prompt>"` for one-shot mode.
- [x] Support interactive mode with a basic prompt loop and `exit`/`quit`.
- [x] Print streamed assistant text and concise tool execution summaries.
- [x] Add flags only for essentials: model, max steps, timeout, and working directory.

### Phase 6: Tests And Docs
- [x] Unit test the loop with a fake model client.
- [x] Unit test `shell` success, failure, and timeout cases.
- [x] Add a smoke test that runs the CLI against a fake session.
- [x] Document local setup, required env vars, and one happy-path example.

## Non-Goals For V1
- [x] File-editing helpers beyond what the shell can already do were not added.
- [x] Rich terminal UI or panes were not added.
- [x] Parallel tool execution was not added.
- [x] Background jobs, task queues, and resumable sessions were not added.
- [x] Provider abstraction for multiple vendors was not added.
- [x] Automatic git operations were not added.

## Risks And Edge Cases
- [x] Tool-calling translation is kept inside the single provider client.
- [x] Shell commands have a hard timeout and surface `timedOut` in the result.
- [x] Shell output is truncated before being fed back into the model.
- [x] The model loop is bounded by `maxSteps`.
- [x] Streaming is supported for assistant text through the OpenAI-compatible SSE response.
- [x] Execution is scoped to the workspace root to avoid accidental path escape.

## Verification Plan
- [x] Run `bun install`.
- [x] Run targeted tests while building each package instead of the whole suite by default.
- [x] Run `bun test`.
- [x] Run root lint with `oxlint`.
- [x] Run root format check with `oxfmt`.
- [x] Manually verify one-shot prompt that only needs text output.
- [x] Manually verify one-shot prompt that triggers `shell`.
- [x] Manually verify interactive mode with at least two turns.
- [x] Manually verify a failing shell command.
- [x] Manually verify a timed out shell command.

## Recommended Build Order
- [x] Scaffold the monorepo.
- [x] Build the provider client with a fake response fixture first.
- [x] Build the `shell` tool and test it in isolation.
- [x] Build the bounded agent loop and test it with a fake model client.
- [x] Wire the CLI on top last.
- [x] Add docs after the smoke path is proven.

## Review
- [x] The implementation landed as a greenfield Bun monorepo with `apps/cli` and `packages/agent-core`.
- [x] Automated verification passed with `bun test`, `bun run lint`, and `bun run format:check`.
- [x] End-to-end CLI verification passed against a local OpenAI-compatible mock server for text-only, tool-call, interactive, failure, and timeout flows.
- [x] Verification found and fixed two real issues before completion: incorrect root script argument forwarding and the wrong default working directory for shell execution.
