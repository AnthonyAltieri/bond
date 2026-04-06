import type { ExecCommandRequest, ExecCommandResponse, ToolServices } from './services.ts';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from './types.ts';
import { createDefaultToolServices } from './services.ts';
import {
  getOptionalBoolean,
  getOptionalNumber,
  getOptionalString,
  getRequiredString,
  parseJsonObject,
} from './shared/json.ts';
import { resolveWorkspacePath } from './shared/workspace.ts';

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250;

interface ExecCommandInput extends ExecCommandRequest {
  justification?: string;
  max_output_tokens?: number;
  prefix_rule?: string[];
  sandbox_permissions?: string;
  yield_time_ms?: number;
}

export function createExecCommandTool(fallbackServices?: Partial<ToolServices>): Tool {
  return {
    definition: {
      description:
        'Run a terminal command and return its output. Use this when the task implies a persistent or interactive process that you will continue through functions.write_stdin; prefer shell for quick one-shot inspection.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          cmd: { type: 'string' },
          justification: { type: 'string' },
          login: { type: 'boolean' },
          max_output_tokens: { type: 'number' },
          prefix_rule: { items: { type: 'string' }, type: 'array' },
          sandbox_permissions: { type: 'string' },
          shell: { type: 'string' },
          tty: { type: 'boolean' },
          workdir: { type: 'string' },
          yield_time_ms: { type: 'number' },
        },
        required: ['cmd'],
        type: 'object',
      },
      kind: 'function',
      name: 'functions.exec_command',
    },
    async execute(inputText, context) {
      const input = parseExecCommandInput(inputText);
      const response = await resolveToolServices(
        context,
        fallbackServices,
      ).execSessions.execCommand({
        cmd: input.cmd,
        login: input.login,
        maxOutputTokens: input.max_output_tokens,
        shell: input.shell ?? context.shell,
        tty: input.tty,
        workdir: resolveWorkspacePath(input.workdir, context),
        yieldTimeMs: input.yield_time_ms ?? DEFAULT_EXEC_YIELD_TIME_MS,
      });

      return formatExecResult('functions.exec_command', response);
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

export function createWriteStdinTool(fallbackServices?: Partial<ToolServices>): Tool {
  return {
    definition: {
      description:
        'Interact with a running terminal session created by functions.exec_command so you can continue the same live process instead of restarting it.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          chars: { type: 'string' },
          max_output_tokens: { type: 'number' },
          session_id: { type: 'number' },
          yield_time_ms: { type: 'number' },
        },
        required: ['session_id'],
        type: 'object',
      },
      kind: 'function',
      name: 'functions.write_stdin',
    },
    async execute(inputText, context) {
      const input = parseWriteStdinInput(inputText);
      const response = await resolveToolServices(context, fallbackServices).execSessions.writeStdin(
        {
          chars: input.chars,
          maxOutputTokens: input.max_output_tokens,
          sessionId: input.session_id,
          yieldTimeMs: input.yield_time_ms ?? DEFAULT_WRITE_STDIN_YIELD_TIME_MS,
        },
      );

      return formatExecResult('functions.write_stdin', response);
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

function formatExecResult(name: string, response: ExecCommandResponse): ToolExecutionResult {
  return {
    content: JSON.stringify(response, null, 2),
    metadata: response,
    name,
    output: JSON.stringify(response, null, 2),
    summary:
      response.exitCode === undefined
        ? `session=${String(response.sessionId)}`
        : `exit=${String(response.exitCode)}`,
  };
}

function parseExecCommandInput(inputText: string): ExecCommandInput {
  const parsed = parseJsonObject(inputText, 'functions.exec_command');

  return {
    cmd: getRequiredString(parsed, 'cmd'),
    justification: getOptionalString(parsed, 'justification'),
    login: getOptionalBoolean(parsed, 'login'),
    max_output_tokens: getOptionalNumber(parsed, 'max_output_tokens'),
    prefix_rule: getOptionalStringArray(parsed, 'prefix_rule'),
    sandbox_permissions: getOptionalString(parsed, 'sandbox_permissions'),
    shell: getOptionalString(parsed, 'shell'),
    tty: getOptionalBoolean(parsed, 'tty'),
    workdir: getOptionalString(parsed, 'workdir'),
    yield_time_ms: getOptionalNumber(parsed, 'yield_time_ms'),
  };
}

function parseWriteStdinInput(inputText: string): {
  chars?: string;
  max_output_tokens?: number;
  session_id: number;
  yield_time_ms?: number;
} {
  const parsed = parseJsonObject(inputText, 'functions.write_stdin');
  const sessionId = getOptionalNumber(parsed, 'session_id');

  if (sessionId === undefined) {
    throw new Error('input requires a finite "session_id" number');
  }

  return {
    chars: getOptionalString(parsed, 'chars'),
    max_output_tokens: getOptionalNumber(parsed, 'max_output_tokens'),
    session_id: sessionId,
    yield_time_ms: getOptionalNumber(parsed, 'yield_time_ms'),
  };
}

function getOptionalStringArray(
  source: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`input "${key}" must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`input ${key}[${String(index)}] must be a string`);
    }

    return entry;
  });
}

function resolveToolServices(
  context: ToolExecutionContext,
  fallbackServices: Partial<ToolServices> | undefined,
): ToolServices {
  return { ...createDefaultToolServices(fallbackServices), ...context.services };
}
