# bond

`bond` is a deliberately small agentic CLI built with Bun. The first version is intentionally narrow: one CLI app, one core package, one OpenAI-compatible provider, and one built-in `shell` tool.

## Layout

- `apps/cli`: terminal entrypoint, arg parsing, and interactive mode
- `packages/agent-core`: agent session loop, provider client, and `shell` tool

## Requirements

- Bun `1.2.22` or newer
- An OpenAI-compatible API endpoint

## Setup

```sh
bun install
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL=your_model_name
```

Optional:

```sh
export OPENAI_BASE_URL=https://api.openai.com/v1
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
bun run cli -- --model your_model --max-steps 8 --timeout 20000 --cwd packages/agent-core "inspect this package"
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

- in-memory conversation state
- one-shot and interactive modes
- bounded tool/model loop
- one `shell` tool

Explicitly out of scope:

- multi-provider support
- approvals or sandboxing
- TUI features
- background jobs or resumable sessions
