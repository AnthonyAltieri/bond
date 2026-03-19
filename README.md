# bond

`bond` is a deliberately small agentic CLI built with Bun. The current version stays intentionally narrow: one CLI app, one core package, one Responses API-compatible provider, and a small `packages/tool-*` layer for local coding tools.

## Structure

- `apps/cli`: argv/env parsing, session construction, interactive loop, stream rendering
- `packages/agent-core/src/agent-session.ts`: orchestrates prompt -> model stream -> tool execution -> follow-up turn -> completion
- `packages/agent-core/src/responses-client.ts`: `POST /responses`, SSE parsing, finalized output extraction
- `packages/agent-core/src/conversation-state.ts`: scaffold items, conversation items, tool outputs
- `packages/agent-core/src/prompt-scaffold.ts`: permissions instructions, repo instructions, environment context
- `packages/agent-core/src/compactor.ts`: summary turn, conversation replacement
- `packages/tool-runtime`: shared tool contracts used by the harness and tool packages
- `packages/tool-shell`: shell execution, stdout/stderr streaming, result summary
- `packages/tool-registry`: default local toolset assembly for the CLI

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
export OPENAI_JUDGE_MODEL=your_judge_model
export OPENAI_JUDGE_MODEL_CORRECTNESS=your_correctness_judge_model
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

Eval mode:

```sh
bun run cli -- eval --manifest evals/demo.json --case demo
bun run cli -- eval --manifest evals/demo.json --all
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
bun run evals # runs only when OPENAI_API_KEY is set
bun run lint
bun run format:check
```

## Scope

Included in v1:

- stateless Responses API requests with in-memory conversation state
- one-shot and interactive modes
- eval runner mode with JSON manifests, objective shell checks, judge summaries, and JSON reports
- bounded tool/model loop with automatic compaction
- explicit local tool packages with one `shell` tool

Explicitly out of scope:

- multi-provider support
- TUI features
- background jobs or resumable sessions
