import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';

import {
  AgentSession,
  OpenAIChatClient,
  type ToolCall,
  createShellTool,
  type AgentEvent,
  type AgentRunResult,
} from '@bond/agent-core';

import { createCliConfig, type CliConfig } from './config.ts';
import { parseArgs } from './args.ts';

type ReadableStream = NodeJS.ReadStream;
type WritableStream = NodeJS.WriteStream;

interface AgentSessionLike {
  stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult>;
}

interface CliContext {
  stderr: Pick<WritableStream, 'write'>;
  stdin: ReadableStream;
  stdout: Pick<WritableStream, 'write'>;
}

interface CliDependencies {
  createSession?: (options: SessionFactoryOptions) => AgentSessionLike;
  cwd?: string;
  env?: Record<string, string | undefined>;
  stderr?: Pick<WritableStream, 'write'>;
  stdin?: ReadableStream;
  stdout?: Pick<WritableStream, 'write'>;
}

interface PromptReader {
  close: () => void;
  nextPrompt: () => Promise<string | undefined>;
}

interface SessionFactoryOptions {
  commandTimeoutMs?: number;
  cwd: string;
  env: Record<string, string | undefined>;
  maxSteps?: number;
  model?: string;
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  try {
    const args = parseArgs(argv);
    const context = createCliContext(dependencies);

    if (args.help) {
      context.stdout.write(`${buildHelpText()}\n`);
      return 0;
    }

    const session = createSession(args, dependencies);

    if (args.prompt) {
      await runAgentTurn(context, session, args.prompt);
      return 0;
    }

    await agentLoop(context, session);
    return 0;
  } catch (error) {
    const stderr = dependencies.stderr ?? process.stderr;
    stderr.write(`${toErrorMessage(error)}\n`);
    return 1;
  }
}

async function agentLoop(context: CliContext, session: AgentSessionLike): Promise<void> {
  const promptReader = createPromptReader(context.stdin, context.stdout);
  context.stdout.write('Interactive mode. Type "exit" or "quit" to leave.\n');

  try {
    while (true) {
      const prompt = await getUserInput(promptReader);

      if (prompt === undefined || isExitPrompt(prompt)) {
        break;
      }

      if (!prompt) {
        continue;
      }

      await runAgentTurn(context, session, prompt);
    }
  } finally {
    promptReader.close();
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

function createCliContext(dependencies: CliDependencies): CliContext {
  return {
    stderr: dependencies.stderr ?? process.stderr,
    stdin: dependencies.stdin ?? process.stdin,
    stdout: dependencies.stdout ?? process.stdout,
  };
}

function createPromptReader(
  stdin: ReadableStream,
  stdout: Pick<WritableStream, 'write'>,
): PromptReader {
  const readline = createInterface({
    input: stdin,
    terminal: false,
  });
  const iterator = readline[Symbol.asyncIterator]();

  return {
    close() {
      readline.close();
    },
    async nextPrompt() {
      stdout.write('> ');
      const next = await iterator.next();

      return next.done ? undefined : next.value.trim();
    },
  };
}

function createSession(
  args: ReturnType<typeof parseArgs>,
  dependencies: CliDependencies,
): AgentSessionLike {
  const runtimeEnv = dependencies.env ?? process.env;
  const cwd = resolve(args.cwd ?? dependencies.cwd ?? process.cwd());

  if (dependencies.createSession) {
    return dependencies.createSession({
      commandTimeoutMs: args.timeoutMs,
      cwd,
      env: runtimeEnv,
      maxSteps: args.maxSteps,
      model: args.model,
    });
  }

  return createDefaultSession(createCliConfig(args, runtimeEnv, cwd));
}

function createDefaultSession(config: CliConfig): AgentSessionLike {
  const client = new OpenAIChatClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  return new AgentSession({
    client,
    commandTimeoutMs: config.commandTimeoutMs,
    cwd: config.cwd,
    maxSteps: config.maxSteps,
    model: config.model,
    tools: [createShellTool()],
  });
}

async function getUserInput(promptReader: PromptReader): Promise<string | undefined> {
  return await promptReader.nextPrompt();
}

function handleAgentOutput(
  context: CliContext,
  output: AgentEvent,
  assistantHasOutput: boolean,
): boolean {
  switch (output.kind) {
    case 'text-delta':
      context.stdout.write(output.chunk);
      return assistantHasOutput || output.chunk.length > 0;
    case 'tool-call':
      return writeToolCall(context, output.call, assistantHasOutput);
    case 'tool-stdout':
      return assistantHasOutput;
    case 'tool-stderr':
      return assistantHasOutput;
    case 'tool-result':
      writeToolResult(context, output.result);
      return assistantHasOutput;
    case 'end':
      writeTurnEnd(context, output.result);
      return assistantHasOutput;
  }
}

function isExitPrompt(prompt: string): boolean {
  return prompt === 'exit' || prompt === 'quit';
}

async function runAgentTurn(
  context: CliContext,
  session: AgentSessionLike,
  prompt: string,
): Promise<void> {
  let assistantHasOutput = false;

  for await (const output of session.stream(prompt)) {
    assistantHasOutput = handleAgentOutput(context, output, assistantHasOutput);
  }

  if (assistantHasOutput) {
    context.stdout.write('\n');
  }
}

function writeToolCall(context: CliContext, call: ToolCall, assistantHasOutput: boolean): boolean {
  if (assistantHasOutput) {
    context.stdout.write('\n');
  }

  context.stderr.write(`[tool:${call.name}] ${call.inputText}\n`);
  return false;
}

function writeToolResult(
  context: CliContext,
  result: Extract<AgentEvent, { kind: 'tool-result' }>['result'],
): void {
  context.stderr.write(`[tool:${result.name}] ${result.summary}\n`);
}

function writeTurnEnd(context: CliContext, result: AgentRunResult): void {
  if (result.stopReason === 'max_steps') {
    context.stderr.write('[agent] stopped after the maximum number of steps\n');
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
