# bond

`bond` is a deliberately small agentic CLI built with Bun. The current version stays intentionally narrow: one CLI app, one core package, one Responses API-compatible provider, and one built-in `shell` tool.

## Structure

- `apps/cli`: argv/env parsing, session construction, interactive loop, stream rendering
- `packages/agent-core/src/agent-session.ts`: orchestrates prompt -> model stream -> tool execution -> follow-up turn -> completion
- `packages/agent-core/src/responses-client.ts`: `POST /responses`, SSE parsing, finalized output extraction
- `packages/agent-core/src/conversation-state.ts`: scaffold items, conversation items, tool outputs
- `packages/agent-core/src/prompt-scaffold.ts`: permissions instructions, repo instructions, environment context
- `packages/agent-core/src/compactor.ts`: summary turn, conversation replacement
- `packages/agent-core/src/tools/shell.ts`: shell execution, stdout/stderr streaming, result summary

## Requirements

- Bun `1.2.22` or newer
- A Responses API-compatible endpoint

## Setup

```sh
bun install
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL=your_model_name
```

Optional:

```sh
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_AUTO_COMPACT_TOKENS=24000
export OPENAI_COMPACTION_MODEL=your_compaction_model
```

## Usage

One-shot mode:

```sh
bun run cli -- "show me the repo files"
```

Interactive mode:

```sh
bun run cli
```

Useful flags:

```sh
bun run cli -- --model your_model --auto-compact-tokens 24000 --timeout 20000 --cwd packages/agent-core "inspect this package"
```

## Example

```text
$ bun run cli -- "what directory are you in?"
[tool:shell] {"command":"pwd"}
[tool:shell] exit=0 timedOut=false cwd=/path/to/workspace
You are in /path/to/workspace.
```

## Tooling

```sh
bun run test
bun run lint
bun run format:check
```

## Scope

Included in v1:

- stateless Responses API requests with in-memory conversation state
- one-shot and interactive modes
- bounded tool/model loop with automatic compaction
- one `shell` tool

Explicitly out of scope:

- multi-provider support
- approvals or full sandbox policy management
- TUI features
- background jobs or resumable sessions
