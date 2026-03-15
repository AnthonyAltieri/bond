import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';

import {
  AgentSession,
  OpenAIChatClient,
  createShellTool,
  type AgentHooks,
  type AgentRunResult,
} from '@bond/agent-core';

import { parseArgs } from './args.ts';

interface AgentSessionLike {
  run(prompt: string, hooks?: AgentHooks): Promise<AgentRunResult>;
}

interface SessionFactoryOptions {
  commandTimeoutMs?: number;
  cwd: string;
  env: Record<string, string | undefined>;
  maxSteps?: number;
  model?: string;
}

interface CliDependencies {
  createSession?: (options: SessionFactoryOptions) => AgentSessionLike;
  cwd?: string;
  env?: Record<string, string | undefined>;
  stderr?: Pick<WritableStream, 'write'>;
  stdin?: ReadableStream;
  stdout?: Pick<WritableStream, 'write'>;
}

type ReadableStream = NodeJS.ReadStream;
type WritableStream = NodeJS.WriteStream;

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  try {
    const args = parseArgs(argv);

    if (args.help) {
      stdout.write(`${buildHelpText()}\n`);
      return 0;
    }

    const cwd = resolve(args.cwd ?? dependencies.cwd ?? process.cwd());
    const env = dependencies.env ?? process.env;
    const session = (dependencies.createSession ?? createDefaultSession)({
      commandTimeoutMs: args.timeoutMs,
      cwd,
      env,
      maxSteps: args.maxSteps,
      model: args.model ?? env.OPENAI_MODEL,
    });

    if (args.prompt) {
      await runPrompt(session, args.prompt, stdout, stderr);
      return 0;
    }

    await runInteractiveSession(session, dependencies.stdin ?? process.stdin, stdout, stderr);
    return 0;
  } catch (error) {
    stderr.write(`${toErrorMessage(error)}\n`);
    return 1;
  }
}

function buildHelpText(): string {
  return [
    'bond agentic cli',
    '',
    'Usage:',
    '  bun run cli -- "inspect the repo"',
    '  bun run cli -- --model gpt-4.1-mini "list the files"',
    '  bun run cli -- --cwd packages/agent-core',
    '',
    'Flags:',
    '  --model <name>       Override OPENAI_MODEL',
    '  --max-steps <n>      Max tool/model loop iterations',
    '  --timeout <ms>       Shell tool timeout in milliseconds',
    '  --cwd <path>         Working directory for the session',
    '  -h, --help           Show this help text',
    '',
    'Environment:',
    '  OPENAI_API_KEY       Required for the default OpenAI client',
    '  OPENAI_MODEL         Required unless --model is passed',
    '  OPENAI_BASE_URL      Optional override for OpenAI-compatible APIs',
  ].join('\n');
}

function createDefaultSession(options: SessionFactoryOptions): AgentSessionLike {
  if (!options.model) {
    throw new Error('OPENAI_MODEL or --model is required');
  }

  const client = new OpenAIChatClient({
    apiKey: options.env.OPENAI_API_KEY ?? '',
    baseUrl: options.env.OPENAI_BASE_URL,
  });

  return new AgentSession({
    client,
    commandTimeoutMs: options.commandTimeoutMs,
    cwd: options.cwd,
    maxSteps: options.maxSteps,
    model: options.model,
    tools: [createShellTool()],
  });
}

async function runInteractiveSession(
  session: AgentSessionLike,
  stdin: ReadableStream,
  stdout: Pick<WritableStream, 'write'>,
  stderr: Pick<WritableStream, 'write'>,
): Promise<void> {
  const readline = createInterface({
    input: stdin,
    terminal: false,
  });

  stdout.write('Interactive mode. Type "exit" or "quit" to leave.\n');
  stdout.write('> ');

  try {
    for await (const line of readline) {
      const prompt = line.trim();

      if (!prompt) {
        stdout.write('> ');
        continue;
      }

      if (prompt === 'exit' || prompt === 'quit') {
        break;
      }

      await runPrompt(session, prompt, stdout, stderr);
      stdout.write('> ');
    }
  } finally {
    readline.close();
  }
}

async function runPrompt(
  session: AgentSessionLike,
  prompt: string,
  stdout: Pick<WritableStream, 'write'>,
  stderr: Pick<WritableStream, 'write'>,
): Promise<void> {
  let assistantHasOutput = false;
  const hooks: AgentHooks = {
    onTextDelta(chunk) {
      assistantHasOutput = assistantHasOutput || chunk.length > 0;
      stdout.write(chunk);
    },
    onToolResult(_call, result) {
      if (assistantHasOutput) {
        stdout.write('\n');
        assistantHasOutput = false;
      }

      stderr.write(`[tool:${result.name}] ${result.summary}\n`);
    },
    onToolStart(call) {
      stderr.write(`[tool:${call.name}] ${call.inputText}\n`);
    },
  };

  const result = await session.run(prompt, hooks);

  if (assistantHasOutput) {
    stdout.write('\n');
  }

  if (result.stopReason === 'max_steps') {
    stderr.write('[agent] stopped after the maximum number of steps\n');
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
