import { isAbsolute, relative, resolve } from 'node:path';

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.ts';

const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

interface ShellToolOptions {
  maxOutputChars?: number;
}

interface ShellInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface ShellSummary {
  cwd: string;
  exitCode: number;
  stderr: string;
  stderrTruncated: boolean;
  stdout: string;
  stdoutTruncated: boolean;
  timedOut: boolean;
}

export function createShellTool(options: ShellToolOptions = {}): Tool {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return {
    definition: {
      description:
        'Run a shell command in the workspace and capture stdout, stderr, and the exit code.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          command: {
            type: 'string',
          },
          cwd: {
            type: 'string',
          },
          timeoutMs: {
            type: 'number',
          },
        },
        required: ['command'],
        type: 'object',
      },
      name: 'shell',
    },
    async execute(inputText, context) {
      const input = parseShellInput(inputText);
      const targetCwd = resolveShellCwd(input.cwd, context);
      const timeoutMs = normalizeTimeout(input.timeoutMs, context.defaultTimeoutMs);

      let timedOut = false;
      const child = Bun.spawn(['sh', '-lc', input.command], {
        cwd: targetCwd,
        stderr: 'pipe',
        stdout: 'pipe',
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        readStreamText(child.stdout),
        readStreamText(child.stderr),
      ]);

      clearTimeout(timer);

      const stdoutSummary = truncate(stdout, maxOutputChars);
      const stderrSummary = truncate(stderr, maxOutputChars);
      const summary: ShellSummary = {
        cwd: targetCwd,
        exitCode,
        stderr: stderrSummary.value,
        stderrTruncated: stderrSummary.truncated,
        stdout: stdoutSummary.value,
        stdoutTruncated: stdoutSummary.truncated,
        timedOut,
      };

      return formatShellResult(summary);
    },
  };
}

function formatShellResult(summary: ShellSummary): ToolExecutionResult {
  return {
    content: JSON.stringify(summary, null, 2),
    metadata: summary,
    name: 'shell',
    summary: `exit=${summary.exitCode} timedOut=${String(summary.timedOut)} cwd=${summary.cwd}`,
  };
}

function normalizeTimeout(timeoutMs: number | undefined, defaultTimeoutMs: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return defaultTimeoutMs;
  }

  return Math.floor(timeoutMs);
}

function parseShellInput(inputText: string): ShellInput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(inputText);
  } catch {
    throw new Error('shell input must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('shell input must be an object');
  }

  const command = getOptionalString(parsed, 'command');
  const cwd = getOptionalString(parsed, 'cwd');
  const timeoutMs = getOptionalNumber(parsed, 'timeoutMs');

  if (!command) {
    throw new Error('shell input requires a non-empty "command" string');
  }

  return {
    command,
    cwd,
    timeoutMs,
  };
}

function getOptionalNumber(source: object, key: string): number | undefined {
  const value = Reflect.get(source, key);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`shell input "${key}" must be a finite number`);
  }

  return value;
}

function getOptionalString(source: object, key: string): string | undefined {
  const value = Reflect.get(source, key);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`shell input "${key}" must be a string`);
  }

  return value;
}

function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const pathRelativeToRoot = relative(workspaceRoot, targetPath);

  return (
    pathRelativeToRoot === '' ||
    (!pathRelativeToRoot.startsWith('..') && !isAbsolute(pathRelativeToRoot))
  );
}

async function readStreamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return '';
  }

  return await new Response(stream).text();
}

function resolveShellCwd(cwd: string | undefined, context: ToolExecutionContext): string {
  const targetCwd = cwd ? resolve(context.workspaceRoot, cwd) : resolve(context.cwd);

  if (!isInsideWorkspace(context.workspaceRoot, targetCwd)) {
    throw new Error('shell cwd must stay inside the workspace root');
  }

  return targetCwd;
}

function truncate(
  value: string,
  maxLength: number,
): {
  truncated: boolean;
  value: string;
} {
  if (value.length <= maxLength) {
    return {
      truncated: false,
      value,
    };
  }

  return {
    truncated: true,
    value: `${value.slice(0, maxLength)}\n...[truncated]`,
  };
}
