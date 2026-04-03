import { describe, expect, test } from 'bun:test';

import { runCli } from '../src/index.ts';
import { MemoryStream } from './helpers/cli-fixtures.ts';

describe('autoresearch command', () => {
  test('runs the autoresearch subcommand and reports the frontier summary', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      [
        'autoresearch',
        '--manifest',
        'autoresearch.json',
        '--program',
        'program.md',
        '--tag',
        'demo',
        '--max-experiments',
        '2',
      ],
      {
        cwd: '/workspace',
        env: { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'agent-model' },
        autoresearchCommand: {
          loadManifest: async () =>
            JSON.stringify({
              editableGlobs: ['apps/cli/src/*.ts'],
              evaluation: {
                rankOrder: [{ direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' }],
                sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
              },
              version: 1,
              webResearch: { enabled: true },
            }),
          loadProgram: async () => '# Improve bond',
          runAutoresearch: async (manifest, program, options) => {
            expect(manifest.webResearch.enabled).toBe(true);
            expect(program).toContain('Improve bond');
            expect(options.tag).toBe('demo');
            await options.onProgress?.({
              branchName: 'autoresearch/demo',
              outputDir: '/workspace/.autoresearch/demo',
              record: {
                browsed: true,
                commit: 'abc1234def',
                experiment: 1,
                metrics: [{ metric: 'overall_pass_rate', sourceId: 'bond', value: 1 }],
                sourceResults: [],
                status: 'keep',
                summary: 'Improved eval performance',
              },
              type: 'experiment-complete',
            });
            return {
              branchName: 'autoresearch/demo',
              experiments: [],
              frontierCommit: 'abc1234def5678',
              outputDir: '/workspace/.autoresearch/demo',
            };
          },
        },
        stderr,
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('experiment=0001 status=keep overall_pass_rate=1');
    expect(stdout.text()).toContain('branch=autoresearch/demo');
    expect(stdout.text()).toContain('frontier=abc1234def5678');
    expect(stdout.text()).toContain('output=/workspace/.autoresearch/demo');
    expect(stderr.text()).toBe('');
  });
});
