import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';

import {
  AgentSession,
  OpenAIJudgeProvider,
  OpenAIResponsesClient,
  runEvalCase,
} from '@bond/agent-core';
import { createShellTool } from '@bond/tool-shell';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? 'gpt-5.4';
const architectureJudgeModel =
  process.env.OPENAI_JUDGE_MODEL_ARCHITECTURE ?? process.env.OPENAI_JUDGE_MODEL ?? model;
const hasApiKey = typeof apiKey === 'string' && apiKey.length > 0;
const goalJudgeModel = process.env.OPENAI_JUDGE_MODEL_GOAL ?? process.env.OPENAI_JUDGE_MODEL ?? model;
const simplicityJudgeModel =
  process.env.OPENAI_JUDGE_MODEL_SIMPLICITY ?? process.env.OPENAI_JUDGE_MODEL ?? model;
const testIfOpenAIKey = hasApiKey ? test : test.skip;

describe('basic OpenAI loop evals', () => {
  testIfOpenAIKey('uses shell tool for pwd and completes', async () => {
    const result = await runAgentEval([
      'Use the shell tool exactly once to run `pwd`.',
      'Then answer with one line: WORKDIR=<absolute_path>.',
    ].join(' '));

    expect(result.stopReason).toBe('completed');
    expect(result.stepsUsed).toBeGreaterThanOrEqual(2);
    expect(result.inputItems.some((item) => item.type === 'function_call')).toBe(true);
    expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
    expect(result.finalText).toContain('WORKDIR=');
  });

  testIfOpenAIKey('uses shell tool for a fast file count command', async () => {
    const result = await runAgentEval([
      'Use the shell tool exactly once to run this command: `find . -maxdepth 1 -type f | wc -l`.',
      'Then answer with one line: FILE_COUNT=<number>.',
    ].join(' '));

    expect(result.stopReason).toBe('completed');
    expect(result.stepsUsed).toBeGreaterThanOrEqual(2);
    expect(result.inputItems.some((item) => item.type === 'function_call')).toBe(true);
    expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
    expect(result.finalText).toContain('FILE_COUNT=');
  });

  testIfOpenAIKey(
    'creates and customizes a small TanStack Router app',
    async () => {
      const tempRoot = await createTempDir('/tmp/bond-tanstack-eval-');

      try {
        const report = await runEvalCase(
          {
            capturePaths: ['src/routes/*.tsx'],
            commandTimeoutMs: 120_000,
            description: 'Creates and customizes a small TanStack Router app',
            finalResponse: { type: 'equals', value: 'EVAL_RESULT=ok' },
            id: 'tanstack-router-app',
            maxSteps: 16,
            objectiveChecks: [
              {
                category: 'build',
                command: 'bun run build',
                name: 'build',
              },
              {
                category: 'content',
                command: [
                  'grep -q "Bond TanStack Demo" src/routes/index.tsx',
                  'grep -q "Live route generation" src/routes/index.tsx',
                  'grep -q "Built by Bond with TanStack Router." src/routes/about.tsx',
                ].join('\n'),
                name: 'content customization',
              },
            ],
            prompt: [
              'Create a small TanStack Router application in the current empty directory.',
              'Use this scaffold command exactly once: `bunx @tanstack/cli@latest create . --router-only --package-manager bun --no-examples --no-git --force`.',
              "After scaffolding, update `src/routes/index.tsx` so the home page contains the exact heading `Bond TanStack Demo` and a feature list item `Live route generation`.",
              "Update `src/routes/about.tsx` so it includes the exact sentence `Built by Bond with TanStack Router.`.",
              'Verify success by running `bun run build`.',
              'When finished, answer with exactly one line: EVAL_RESULT=ok',
            ].join(' '),
            workingDirectoryMode: 'temp-empty',
          },
          {
            client: new OpenAIResponsesClient({ apiKey, baseUrl: process.env.OPENAI_BASE_URL }),
            judgeModels: {
              architecture: architectureJudgeModel,
              correctness: process.env.OPENAI_JUDGE_MODEL_CORRECTNESS ?? process.env.OPENAI_JUDGE_MODEL ?? model,
              goal: goalJudgeModel,
              simplicity: simplicityJudgeModel,
            },
            judgeProvider: new OpenAIJudgeProvider({
              apiKey,
              baseUrl: process.env.OPENAI_BASE_URL,
            }),
            model,
            repoRoot: tempRoot,
            tools: [createShellTool()],
          },
        );
        const indexRoute = report.capturedFiles.find((file) => file.path === 'src/routes/index.tsx');
        const aboutRoute = report.capturedFiles.find((file) => file.path === 'src/routes/about.tsx');

        expect(report.status.stopReason).toBe('completed');
        expect(report.status.stepsUsed).toBeGreaterThanOrEqual(3);
        expect(report.finalResponse.trim()).toBe('EVAL_RESULT=ok');
        expect(report.objectivePassed).toBe(true);
        expect(report.judges.results).toHaveLength(4);
        expect(indexRoute?.content).toContain('Bond TanStack Demo');
        expect(indexRoute?.content).toContain('Live route generation');
        expect(aboutRoute?.content).toContain('Built by Bond with TanStack Router.');
      } finally {
        await rm(tempRoot, { force: true, recursive: true });
      }
    },
    180_000,
  );

  testIfOpenAIKey(
    'creates a TanStack Start endpoint when prompted',
    async () => {
      const tempRoot = await createTempDir('/tmp/bond-tanstack-start-endpoint-eval-');

      try {
        const result = await runAgentEval(
          [
            'Create a small TanStack Start application in the current empty directory.',
            'Use this scaffold command exactly once: `bunx @tanstack/cli@latest create . --package-manager bun --no-examples --no-git --force`.',
            'Follow the generated README API-route pattern: add an API route at `/api/hello` using TanStack Start route server handlers so a GET request returns JSON with `message` set to `Hello from Bond`.',
            'Update `src/routes/index.tsx` so the page mentions the exact endpoint path `/api/hello`.',
            'Do not leave the scaffolded starter copy unchanged; make sure `/api/hello` appears in `src/routes/index.tsx` before you finish.',
            'Verify success by running `bun run build`.',
            'When finished, answer with exactly one line: EVAL_RESULT=ok',
          ].join(' '),
          {
            commandTimeoutMs: 120_000,
            cwd: tempRoot,
            maxSteps: 16,
          },
        );
        const [indexRoute, endpointRoutePaths] = await Promise.all([
          readFile(`${tempRoot}/src/routes/index.tsx`, 'utf8'),
          findRouteFilesContaining(`${tempRoot}/src/routes`, '/api/hello'),
        ]);
        const buildResult = await runCommand(tempRoot, ['bun', 'run', 'build']);
        const endpointResponse = await fetchJsonFromDevServer(tempRoot, '/api/hello');
        const endpointRouteContents = await Promise.all(
          endpointRoutePaths.map((filePath) => readFile(filePath, 'utf8')),
        );

        expect(result.stopReason).toBe('completed');
        expect(result.stepsUsed).toBeGreaterThanOrEqual(3);
        expect(result.inputItems.some((item) => item.type === 'function_call')).toBe(true);
        expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
        expect(result.finalText.trim()).toBe('EVAL_RESULT=ok');
        expect(indexRoute).toContain('/api/hello');
        expect(endpointRoutePaths.length).toBeGreaterThan(0);
        expect(
          endpointRouteContents.some(
            (content) => content.includes('/api/hello') && content.includes('GET'),
          ),
        ).toBe(true);
        expect(buildResult.exitCode).toBe(0);
        expect(endpointResponse).toEqual({ message: 'Hello from Bond' });
      } finally {
        await rm(tempRoot, { force: true, recursive: true });
      }
    },
    180_000,
  );
});

async function runAgentEval(
  prompt: string,
  options: {
    commandTimeoutMs?: number;
    cwd?: string;
    maxSteps?: number;
  } = {},
) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for evals');
  }

  const client = new OpenAIResponsesClient({ apiKey, baseUrl: process.env.OPENAI_BASE_URL });
  const session = new AgentSession({
    client,
    commandTimeoutMs: options.commandTimeoutMs,
    cwd: options.cwd ?? process.cwd(),
    maxSteps: options.maxSteps ?? 4,
    model,
    tools: [createShellTool()],
  });

  return session.run(prompt);
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(directory, { recursive: true });
  return directory;
}

async function runCommand(
  cwd: string,
  command: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn(command, {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
}

async function findRouteFilesContaining(directory: string, needle: string): Promise<string[]> {
  const matches: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      matches.push(...(await findRouteFilesContaining(entryPath, needle)));
      continue;
    }

    const content = await readFile(entryPath, 'utf8');

    if (content.includes(needle)) {
      matches.push(entryPath);
    }
  }

  return matches;
}

async function fetchJsonFromDevServer(
  cwd: string,
  path: string,
): Promise<Record<string, unknown>> {
  const port = pickPort();
  const child = Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdoutPromise = child.stdout ? new Response(child.stdout).text() : Promise.resolve('');
  const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve('');

  try {
    const response = await waitForJson(`http://127.0.0.1:${port}${path}`);
    return response;
  } catch (error) {
    child.kill();
    await child.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    throw new Error(
      `Dev server verification failed: ${toErrorMessage(error)}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  } finally {
    child.kill();
    await child.exited;
    await Promise.all([stdoutPromise, stderrPromise]);
  }
}

function pickPort(): number {
  return 3200 + Math.floor(Math.random() * 200);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForJson(url: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
    } catch {
      // Server is still starting up.
    }

    await Bun.sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}
