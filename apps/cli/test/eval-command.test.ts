import { describe, expect, test } from 'bun:test';

import { runCli } from '../src/index.ts';
import { makeEvalReport, MemoryStream } from './helpers/cli-fixtures.ts';

describe('eval command', () => {
  test('runs the eval subcommand and reports the JSON output path', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const writtenReports: Array<{ path: string; report: ReturnType<typeof makeEvalReport> }> = [];

    const exitCode = await runCli(
      ['eval', '--manifest', 'evals/demo.json', '--case', 'demo', '--output', 'reports/demo.json'],
      {
        cwd: '/workspace',
        env: {
          OPENAI_API_KEY: 'test-key',
          OPENAI_JUDGE_MODEL: 'judge-model',
          OPENAI_MODEL: 'agent-model',
        },
        evalCommand: {
          loadManifest: async () =>
            JSON.stringify({
              cases: [
                {
                  description: 'Demo case',
                  id: 'demo',
                  prompt: 'Say ok',
                  workingDirectoryMode: 'repo',
                },
              ],
              version: 1,
            }),
          runManifest: async () => [makeEvalReport()],
          writeReportFile: async (path, report) => {
            writtenReports.push({ path, report });
          },
        },
        stderr,
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('eval:demo');
    expect(stdout.text()).toContain('correctness=4');
    expect(stdout.text()).toContain('report=/workspace/reports/demo.json');
    expect(writtenReports).toEqual([
      { path: '/workspace/reports/demo.json', report: makeEvalReport() },
    ]);
    expect(stderr.text()).toBe('');
  });

  test('falls back to the main model when no judge model override is configured', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(['eval', '--manifest', 'evals/demo.json', '--all'], {
      cwd: '/workspace',
      env: { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'agent-model' },
      evalCommand: {
        loadManifest: async () =>
          JSON.stringify({
            cases: [
              {
                description: 'Demo case',
                id: 'demo',
                prompt: 'Say ok',
                workingDirectoryMode: 'repo',
              },
            ],
            version: 1,
          }),
        runManifest: async (_manifest, options) => {
          expect(options.judgeModels).toEqual({
            architecture: 'agent-model',
            correctness: 'agent-model',
            goal: 'agent-model',
            simplicity: 'agent-model',
          });
          return [makeEvalReport()];
        },
        writeReportFile: async () => {},
      },
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('eval:demo');
    expect(stderr.text()).toBe('');
  });
});
