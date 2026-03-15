import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';

import type { AgentEvent, AgentRunResult, ToolExecutionResult } from '@bond/agent-core';

import { runCli } from '../src/run-cli.ts';

describe('cli smoke', () => {
  test('handles a one-shot prompt with tool activity', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const prompts: string[] = [];

    const exitCode = await runCli(['inspect'], {
      createSession: () => makeSmokeSession(prompts),
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(prompts).toEqual(['inspect']);
    expect(stdout.text()).toContain('done:inspect');
    expect(stderr.text()).toContain('[tool:shell]');
  });

  test('handles a brief interactive session', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const prompts: string[] = [];
    const stdin = new PassThrough();
    stdin.end('first\nsecond\nquit\n');

    const exitCode = await runCli([], {
      createSession: () => makeSmokeSession(prompts),
      stderr,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(prompts).toEqual(['first', 'second']);
    expect(stdout.text()).toContain('done:first');
    expect(stdout.text()).toContain('done:second');
    expect(stderr.text()).toBe('');
  });
});

function makeSmokeSession(prompts: string[]) {
  return {
    async *stream(prompt: string): AsyncGenerator<AgentEvent, AgentRunResult> {
      prompts.push(prompt);

      if (prompt === 'inspect') {
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', name: 'shell' },
          kind: 'tool-call',
        };
        yield {
          call: { id: 'call_1', inputText: '{"command":"pwd"}', name: 'shell' },
          kind: 'tool-result',
          result: makeToolResult(),
        };
      }

      yield { chunk: `done:${prompt}`, kind: 'text-delta' };

      const result = {
        finalText: `done:${prompt}`,
        messages: [],
        stepsUsed: 1,
        stopReason: 'completed',
      };

      yield { kind: 'end', result };

      return result;
    },
  };
}

class MemoryStream extends PassThrough {
  private readonly chunks: string[] = [];

  override write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));

    if (typeof encoding === 'function') {
      return super.write(chunk, encoding);
    }

    return super.write(chunk, encoding, callback);
  }

  text(): string {
    return this.chunks.join('');
  }
}

function makeToolResult(): ToolExecutionResult {
  return { content: '{"stdout":"test"}', name: 'shell', summary: 'exit=0 timedOut=false cwd=/tmp' };
}
