import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';

import { runCli } from '../src/index.ts';
import { makeSmokeSession, MemoryStream } from './helpers/cli-fixtures.ts';

describe('chat mode', () => {
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

  test('renders plan updates without generic update_plan tool noise', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(['plan'], {
      createSession: () => makeSmokeSession([]),
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('done:plan');
    expect(stderr.text()).toContain('[plan]');
    expect(stderr.text()).toContain('- [in_progress] Implement the change');
    expect(stderr.text()).not.toContain('[tool:update_plan]');
  });
});
