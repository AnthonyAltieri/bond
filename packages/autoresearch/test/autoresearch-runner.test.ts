import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ModelClient,
  ModelTurnEvent,
  ModelTurnParams,
  ModelTurnResult,
} from '@bond/agent-core';
import {
  parseAutoresearchManifest,
  runAutoresearch,
  type AutoresearchGitOps,
  type WebResearchResult,
} from '@bond/autoresearch';
import type { EvalManifest, EvalRunReport } from '@bond/evals';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('parseAutoresearchManifest', () => {
  test('parses a manifest with shell and bond_eval sources', async () => {
    const manifest = await parseAutoresearchManifest(
      JSON.stringify({
        editableGlobs: ['apps/cli/src/*.ts'],
        evaluation: {
          rankOrder: [
            { direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' },
            { direction: 'lower', metric: 'latency_ms', sourceId: 'checks' },
          ],
          sources: [
            { id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' },
            {
              command: 'echo latency_ms=120',
              id: 'checks',
              metrics: [{ name: 'latency_ms', regex: 'latency_ms=(\\d+)' }],
              type: 'shell',
            },
          ],
        },
        version: 1,
        webResearch: { enabled: true },
      }),
    );

    expect(manifest.webResearch.enabled).toBe(true);
    expect(manifest.evaluation.sources).toHaveLength(2);
  });

  test('rejects rankOrder references to unknown metrics', async () => {
    await expect(
      parseAutoresearchManifest(
        JSON.stringify({
          editableGlobs: ['packages/agent-core/src/*.ts'],
          evaluation: {
            rankOrder: [{ direction: 'higher', metric: 'missing', sourceId: 'bond' }],
            sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
          },
          version: 1,
        }),
      ),
    ).rejects.toThrow('missing');
  });
});

describe('runAutoresearch', () => {
  test('records a baseline, keeps an improvement, and discards a regression', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));
    const outputDir = join(repoRoot, '.bond', 'autoresearch', 'demo');

    try {
      const git = new FakeGitOps(
        [[], ['apps/cli/src/run-cli.ts'], [], ['apps/cli/src/run-cli.ts']],
        ['commit-keep', 'commit-discard'],
      );
      const browser = new FakeBrowser();
      const evalQueue = [0.4, 0.7, 0.3];
      const result = await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            captureGlobs: [],
            editableGlobs: ['apps/cli/src/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' }],
              sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
            },
            version: 1,
            webResearch: { enabled: true },
          }),
        ),
        '# Improve bond',
        {
          browser,
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 2,
          model: 'agent-model',
          outputDir,
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async () => ({
              compactionsUsed: 0,
              finalText: 'Improve CLI recovery',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed',
            }),
          }),
          git,
          loadEvalManifest: async () => JSON.stringify(makeEvalManifest()),
          runEvalManifest: async () => [makeEvalReport(evalQueue.shift() ?? 0)],
        },
      );

      const resultsTsv = await readFile(join(outputDir, 'results.tsv'), 'utf8');
      const webNotes = await readFile(
        join(outputDir, 'experiments', '0001', 'web-notes.md'),
        'utf8',
      );

      expect(result.frontierCommit).toBe('commit-keep');
      expect(result.experiments.map((experiment) => experiment.status)).toEqual([
        'keep',
        'keep',
        'discard',
      ]);
      expect(git.resets).toEqual(['commit-keep']);
      expect(resultsTsv).toContain('0000');
      expect(resultsTsv).toContain('0001');
      expect(resultsTsv).toContain('0002');
      expect(webNotes).toContain('Search findings');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test('crashes when the agent edits outside editable globs', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));

    try {
      const git = new FakeGitOps([[], ['README.md']], ['commit-oob']);
      const result = await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            editableGlobs: ['packages/agent-core/src/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' }],
              sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
            },
            version: 1,
          }),
        ),
        '# Improve bond',
        {
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 1,
          model: 'agent-model',
          outputDir: join(repoRoot, '.bond', 'autoresearch', 'demo'),
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async () => ({
              compactionsUsed: 0,
              finalText: 'Touched README',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed',
            }),
          }),
          git,
          loadEvalManifest: async () => JSON.stringify(makeEvalManifest()),
          runEvalManifest: async () => [makeEvalReport(0.4)],
        },
      );

      expect(result.experiments.at(-1)?.status).toBe('crash');
      expect(git.resets).toEqual(['baseline-commit']);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test('records browser failures as crash records and continues running', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));
    const outputDir = join(repoRoot, '.bond', 'autoresearch', 'demo');
    let browserCalls = 0;
    const evalQueue = [0.4, 0.7];

    try {
      const git = new FakeGitOps([[], [], ['apps/cli/src/run-cli.ts']], ['commit-keep']);
      const result = await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            editableGlobs: ['apps/cli/src/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' }],
              sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
            },
            version: 1,
            webResearch: { enabled: true },
          }),
        ),
        '# Improve bond',
        {
          browser: {
            research: async (): Promise<WebResearchResult> => {
              browserCalls += 1;

              if (browserCalls === 1) {
                throw new Error('web lookup failed');
              }

              return {
                ideas: ['Retry with a narrower prompt'],
                notes: 'Search findings',
                sources: [{ title: 'Doc', url: 'https://example.com' }],
              };
            },
          },
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 2,
          model: 'agent-model',
          outputDir,
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async () => ({
              compactionsUsed: 0,
              finalText: 'Improve CLI recovery',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed',
            }),
          }),
          git,
          loadEvalManifest: async () => JSON.stringify(makeEvalManifest()),
          runEvalManifest: async () => [makeEvalReport(evalQueue.shift() ?? 0)],
        },
      );

      const crashSummary = await readFile(
        join(outputDir, 'experiments', '0001', 'summary.txt'),
        'utf8',
      );
      const crashError = await readFile(
        join(outputDir, 'experiments', '0001', 'error.txt'),
        'utf8',
      );

      expect(result.experiments.map((experiment) => experiment.status)).toEqual([
        'keep',
        'crash',
        'keep',
      ]);
      expect(result.frontierCommit).toBe('commit-keep');
      expect(crashSummary).toContain('web lookup failed');
      expect(crashError).toContain('web lookup failed');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test('ignores pre-existing untracked files when validating experiment edits', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));
    const outputDir = join(repoRoot, '.bond', 'autoresearch', 'demo');
    const evalQueue = [0.4, 0.7];

    try {
      const git = new FakeGitOps(
        [['autoresearch-live.log'], ['autoresearch-live.log', 'apps/cli/src/run-cli.ts']],
        ['commit-keep'],
      );
      const result = await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            editableGlobs: ['apps/cli/src/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'overall_pass_rate', sourceId: 'bond' }],
              sources: [{ id: 'bond', manifestPath: 'evals/demo.json', type: 'bond_eval' }],
            },
            version: 1,
          }),
        ),
        '# Improve bond',
        {
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 1,
          model: 'agent-model',
          outputDir,
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async () => ({
              compactionsUsed: 0,
              finalText: 'Improve CLI recovery',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed',
            }),
          }),
          git,
          loadEvalManifest: async () => JSON.stringify(makeEvalManifest()),
          runEvalManifest: async () => [makeEvalReport(evalQueue.shift() ?? 0)],
        },
      );

      expect(result.experiments.map((experiment) => experiment.status)).toEqual(['keep', 'keep']);
      expect(result.frontierCommit).toBe('commit-keep');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test('captures shell failure diagnostics and artifacts', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));
    const outputDir = join(repoRoot, '.autoresearch', 'demo');

    try {
      const git = new FakeGitOps([[]], []);
      const result = await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            editableGlobs: ['apps/cli/src/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'score', sourceId: 'focused_tests' }],
              sources: [
                {
                  command: "printf 'score=1\\n'; printf 'failing test name\\n' >&2; exit 1",
                  id: 'focused_tests',
                  metrics: [{ name: 'score', regex: 'score=(\\d+)' }],
                  type: 'shell',
                },
              ],
            },
            version: 1,
          }),
        ),
        '# Improve bond',
        {
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 1,
          model: 'agent-model',
          outputDir,
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async () => ({
              compactionsUsed: 0,
              finalText: 'No changes',
              inputItems: [],
              stepsUsed: 1,
              stopReason: 'completed',
            }),
          }),
          git,
        },
      );

      const shellResult = result.experiments[0]?.sourceResults[0];
      const stdoutArtifact = join(
        repoRoot,
        shellResult?.artifacts?.find((path) => path.endsWith('.stdout.txt')) ?? '',
      );
      const stderrArtifact = join(
        repoRoot,
        shellResult?.artifacts?.find((path) => path.endsWith('.stderr.txt')) ?? '',
      );

      expect(shellResult?.details).toContain('exit=1');
      expect(shellResult?.details).toContain('sample="failing test name"');
      expect(
        shellResult?.artifacts?.some((path) =>
          path.includes('.autoresearch/demo/experiments/0000/shell/focused_tests.stdout.txt'),
        ),
      ).toBe(true);
      expect(
        shellResult?.artifacts?.some((path) =>
          path.includes('.autoresearch/demo/experiments/0000/shell/focused_tests.stderr.txt'),
        ),
      ).toBe(true);
      expect(await readFile(stdoutArtifact, 'utf8')).toContain('score=1');
      expect(await readFile(stderrArtifact, 'utf8')).toContain('failing test name');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test('steers later prompts away from repeated no-gain edit hotspots', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'bond-autoresearch-'));
    const prompts: string[] = [];

    try {
      const git = new FakeGitOps(
        [
          [],
          [
            'packages/agent-core/src/system-prompt.ts',
            'packages/agent-core/test/agent-session.test.ts',
          ],
          [],
          [
            'packages/agent-core/src/system-prompt.ts',
            'packages/agent-core/test/agent-session.test.ts',
          ],
          [],
          [
            'packages/agent-core/src/system-prompt.ts',
            'packages/agent-core/test/agent-session.test.ts',
          ],
        ],
        ['commit-1', 'commit-2', 'commit-3'],
      );

      await runAutoresearch(
        await parseAutoresearchManifest(
          JSON.stringify({
            editableGlobs: ['packages/agent-core/src/*.ts', 'packages/agent-core/test/*.ts'],
            evaluation: {
              rankOrder: [{ direction: 'higher', metric: 'score', sourceId: 'focused_tests' }],
              sources: [
                {
                  command: "printf 'score=1\\n'; printf 'still failing\\n' >&2; exit 1",
                  id: 'focused_tests',
                  metrics: [{ name: 'score', regex: 'score=(\\d+)' }],
                  type: 'shell',
                },
              ],
            },
            version: 1,
          }),
        ),
        '# Improve bond',
        {
          client: new NoopModelClient(),
          judgeModels: {
            architecture: 'judge',
            correctness: 'judge',
            goal: 'judge',
            simplicity: 'judge',
          },
          judgeProvider: { evaluate: async () => ({}) as never },
          maxExperiments: 3,
          model: 'agent-model',
          outputDir: join(repoRoot, '.autoresearch', 'demo'),
          repoRoot,
          shell: 'sh',
          tag: 'demo',
          tools: [],
        },
        {
          createSession: () => ({
            run: async (prompt: string) => {
              prompts.push(prompt);

              return {
                compactionsUsed: 0,
                finalText: 'Prompt-only tweak',
                inputItems: [],
                stepsUsed: 1,
                stopReason: 'completed',
              };
            },
          }),
          git,
        },
      );

      expect(prompts).toHaveLength(3);
      expect(prompts[2]).toContain('Prioritize fixing persistent required evaluation failures');
      expect(prompts[2]).toContain('packages/agent-core/src/system-prompt.ts (2x)');
      expect(prompts[2]).toContain('repeated_recent_edit_hotspots=');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

describe('OpenAIWebResearcher', () => {
  test('requests a web-search-backed structured response', async () => {
    let requestBody = '';
    globalThis.fetch = (async (_input, init) => {
      requestBody = String(init?.body ?? '');

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            ideas: ['Tighten recovery heuristics'],
            notes: 'Search findings',
            sources: [{ title: 'Example', url: 'https://example.com' }],
          }),
        }),
      );
    }) as typeof fetch;

    const { OpenAIWebResearcher } = await import('@bond/autoresearch');
    const researcher = new OpenAIWebResearcher({ apiKey: 'test-key', model: 'gpt-test' });
    const result = await researcher.research({
      domainsAllowlist: ['example.com'],
      frontierSummary: 'frontier',
      maxQueries: 2,
      program: 'program',
      recentExperiments: [],
      repoContext: '/workspace',
    });

    const parsedBody = JSON.parse(requestBody) as {
      model: string;
      text: { format: { schema: { properties: { sources: { items: { required: string[] } } } } } };
      tools: Array<{ type: string }>;
    };

    expect(parsedBody.model).toBe('gpt-test');
    expect(parsedBody.tools).toEqual([{ type: 'web_search' }]);
    expect(parsedBody.text.format.schema.properties.sources.items.required).toContain('title');
    expect(result.notes).toBe('Search findings');
    expect(result.sources[0]?.url).toBe('https://example.com');
  });
});

class FakeBrowser {
  async research(): Promise<WebResearchResult> {
    return {
      ideas: ['Try a smaller prompt tweak'],
      notes: 'Search findings',
      sources: [{ title: 'Doc', url: 'https://example.com' }],
    };
  }
}

class FakeGitOps implements AutoresearchGitOps {
  readonly resets: string[] = [];

  private current = 'main';

  private head = 'baseline-commit';

  constructor(
    private readonly changedPathsQueue: string[][],
    private readonly commitQueue: string[],
  ) {}

  async branchExists(_repoRoot: string, branchName: string): Promise<boolean> {
    return branchName === 'autoresearch/demo' && this.current === branchName;
  }

  async changedPaths(): Promise<string[]> {
    return this.changedPathsQueue.shift() ?? [];
  }

  async commitAll(_repoRoot: string, _message: string): Promise<string> {
    this.head = this.commitQueue.shift() ?? this.head;
    return this.head;
  }

  async createBranch(_repoRoot: string, branchName: string): Promise<void> {
    this.current = branchName;
  }

  async currentBranch(): Promise<string> {
    return this.current;
  }

  async ensureCleanTrackedWorktree(): Promise<void> {}

  async ensureExcluded(): Promise<void> {}

  async headCommit(): Promise<string> {
    return this.head;
  }

  async resetHard(_repoRoot: string, ref: string): Promise<void> {
    this.resets.push(ref);
    this.head = ref;
  }

  async switchBranch(_repoRoot: string, branchName: string): Promise<void> {
    this.current = branchName;
  }
}

function makeEvalManifest(): EvalManifest {
  return {
    cases: [
      { description: 'Demo case', id: 'demo', prompt: 'Say ok', workingDirectoryMode: 'repo' },
    ],
    version: 1,
  };
}

function makeEvalReport(overallPassRate: number): EvalRunReport {
  const overallPassed = overallPassRate >= 0.5;

  return {
    capturedFiles: [],
    case: {
      description: 'Demo case',
      id: 'demo',
      prompt: 'Say ok',
      workingDirectory: '/workspace',
      workingDirectoryMode: 'repo',
    },
    durationMs: 10,
    finalResponse: 'ok',
    judgePassed: overallPassed,
    judges: {
      blockingIssues: [],
      combinedSummary: 'summary',
      compositePercent: 80,
      compositeScore: overallPassRate * 5,
      needsHumanReview: false,
      passed: overallPassed,
      results: [
        {
          confidence: 'high',
          id: 'correctness_critic',
          issues: [],
          label: 'Correctness Critic',
          pass: overallPassed,
          passThreshold: 4,
          score: overallPassed ? 5 : 2,
          strengths: [],
          summary: 'summary',
          weight: 0.25,
        },
      ],
    },
    model: 'agent-model',
    objectiveChecks: [],
    objectivePassed: overallPassed,
    overallPassed,
    startedAt: '2026-03-19T00:00:00.000Z',
    status: { compactionsUsed: 0, stepsUsed: 1, stopReason: 'completed' },
  };
}

class NoopModelClient implements ModelClient {
  async *streamTurn(_params: ModelTurnParams): AsyncGenerator<ModelTurnEvent, ModelTurnResult> {
    yield { chunk: '', kind: 'text-delta' };
    return { assistantText: '', items: [], toolCalls: [] };
  }
}
