import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { AgentSession } from '@bond/agent';
import {
  ARCHITECTURE_CRITIC,
  CORRECTNESS_CRITIC,
  GOAL_CRITIC,
  SIMPLICITY_CRITIC,
  runJudgeEnsemble,
} from '@bond/judges';

import type {
  EvalCase,
  EvalCaseInput,
  EvalFinalResponseMatcher,
  EvalManifest,
  EvalManifestInput,
  EvalObjectiveCheckResult,
  EvalObjectiveCheckSpec,
  EvalRunReport,
  EvalToolUsageSummary,
  RunEvalCaseOptions,
  RunEvalManifestOptions,
} from './types.ts';
import { EvalCaseSchema, EvalManifestSchema } from './types.ts';

const DEFAULT_TEMP_ROOT = '/tmp';

export async function parseEvalManifest(source: string): Promise<EvalManifest> {
  return EvalManifestSchema.parse(JSON.parse(source) as unknown);
}

export async function runEvalManifest(
  manifest: EvalManifestInput,
  options: RunEvalManifestOptions,
): Promise<EvalRunReport[]> {
  const normalizedManifest = EvalManifestSchema.parse(manifest);
  const selectedCases =
    options.caseIds && options.caseIds.length > 0
      ? normalizedManifest.cases.filter((entry) => options.caseIds?.includes(entry.id))
      : normalizedManifest.cases;

  if (selectedCases.length === 0) {
    throw new Error('No eval cases matched the requested selection');
  }

  const reports: EvalRunReport[] = [];

  for (const entry of selectedCases) {
    reports.push(await runEvalCase(entry, options));
  }

  return reports;
}

export async function runEvalCase(
  entry: EvalCaseInput,
  options: RunEvalCaseOptions,
): Promise<EvalRunReport> {
  const normalizedEntry = EvalCaseSchema.parse(entry);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const runId = randomUUID();
  const shell = options.shell ?? 'sh';
  const baseWorkspace =
    normalizedEntry.workingDirectoryMode === 'repo'
      ? resolve(options.repoRoot)
      : await createTempDir(options.tempRoot ?? DEFAULT_TEMP_ROOT);

  try {
    const renderedEntry = renderEvalCaseTemplates(normalizedEntry, { runId });
    const session = new AgentSession({
      client: options.client,
      commandTimeoutMs: renderedEntry.commandTimeoutMs ?? options.commandTimeoutMs,
      cwd: baseWorkspace,
      maxSteps: renderedEntry.maxSteps,
      model: options.model,
      toolServices: options.toolServices,
      shell,
      tools: options.tools,
    });
    const agentResult = await session.run(renderedEntry.prompt);
    const toolUsage = summarizeToolUsage(agentResult.inputItems, agentResult.toolTrace);
    const finalResponseCheck = evaluateFinalResponse(
      renderedEntry.finalResponse,
      agentResult.finalText,
    );
    const minStepsCheck = evaluateMinSteps(renderedEntry.minSteps, agentResult.stepsUsed);
    const requiredToolsCheck = evaluateRequiredTools(renderedEntry.requiredTools, toolUsage);
    const toolUsageChecks = evaluateToolUsageChecks(renderedEntry.toolUsageChecks, toolUsage);
    const objectiveCheckResults = await Promise.all(
      renderedEntry.objectiveChecks.map((check) =>
        runObjectiveCheck(check, {
          cwd: baseWorkspace,
          shell,
          timeoutMs: renderedEntry.commandTimeoutMs ?? options.commandTimeoutMs,
        }),
      ),
    );
    const allObjectiveChecks = [
      ...(finalResponseCheck ? [finalResponseCheck] : []),
      ...(minStepsCheck ? [minStepsCheck] : []),
      ...(requiredToolsCheck ? [requiredToolsCheck] : []),
      ...toolUsageChecks,
      ...objectiveCheckResults,
    ];
    const capturedFiles = await captureArtifacts(baseWorkspace, renderedEntry.capturePaths);
    const judges = await runJudgeEnsemble(
      options.judgeProvider,
      {
        changedFiles: capturedFiles,
        executionSummary: buildExecutionSummary(
          baseWorkspace,
          renderedEntry,
          runId,
          agentResult,
          toolUsage,
        ),
        finalResponse: agentResult.finalText,
        objectiveChecks: allObjectiveChecks.map((check) => ({
          category: check.category,
          details: check.details,
          name: check.name,
          passed: check.passed,
        })),
        taskPrompt: renderedEntry.prompt,
      },
      [
        { model: options.judgeModels.architecture, spec: ARCHITECTURE_CRITIC },
        { model: options.judgeModels.simplicity, spec: SIMPLICITY_CRITIC },
        { model: options.judgeModels.goal, spec: GOAL_CRITIC },
        { model: options.judgeModels.correctness, spec: CORRECTNESS_CRITIC },
      ],
    );
    const objectivePassed = allObjectiveChecks.every((check) => check.passed);

    return {
      capturedFiles,
      case: {
        description: normalizedEntry.description,
        id: normalizedEntry.id,
        prompt: normalizedEntry.prompt,
        workingDirectory: baseWorkspace,
        workingDirectoryMode: normalizedEntry.workingDirectoryMode,
      },
      durationMs: Date.now() - startedMs,
      finalResponse: agentResult.finalText,
      judgePassed: judges.passed,
      judges,
      model: options.model,
      objectiveChecks: allObjectiveChecks,
      objectivePassed,
      overallPassed: objectivePassed && judges.passed,
      runId,
      startedAt,
      status: {
        compactionsUsed: agentResult.compactionsUsed,
        plan: agentResult.plan,
        stepsUsed: agentResult.stepsUsed,
        stopReason: agentResult.stopReason,
        toolTrace: agentResult.toolTrace,
        toolUsage,
      },
    };
  } finally {
    if (normalizedEntry.workingDirectoryMode === 'temp-empty') {
      await rm(baseWorkspace, { force: true, recursive: true });
    }
  }
}

export function formatEvalReportSummary(report: EvalRunReport): string {
  return [
    `eval:${report.case.id}`,
    `objective=${report.objectivePassed ? 'pass' : 'fail'}`,
    `judges=${report.judgePassed ? 'pass' : 'fail'}`,
    `overall=${report.overallPassed ? 'pass' : 'fail'}`,
    `score=${report.judges.compositeScore}/5`,
    `architecture=${readJudgeScore(report, ARCHITECTURE_CRITIC.id)}`,
    `simplicity=${readJudgeScore(report, SIMPLICITY_CRITIC.id)}`,
    `goal=${readJudgeScore(report, GOAL_CRITIC.id)}`,
    `correctness=${readJudgeScore(report, CORRECTNESS_CRITIC.id)}`,
    report.judges.needsHumanReview ? 'needs_human_review=yes' : 'needs_human_review=no',
  ].join(' ');
}

export async function writeEvalReport(path: string, report: EvalRunReport): Promise<void> {
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(report, null, 2));
}

function buildExecutionSummary(
  cwd: string,
  entry: EvalCase,
  runId: string,
  result: { compactionsUsed: number; stopReason: 'completed' | 'max_steps'; stepsUsed: number },
  toolUsage: EvalToolUsageSummary,
): string {
  return [
    `workspace=${cwd}`,
    `runId=${runId}`,
    `workingDirectoryMode=${entry.workingDirectoryMode}`,
    `stopReason=${result.stopReason}`,
    `stepsUsed=${result.stepsUsed}`,
    `compactionsUsed=${result.compactionsUsed}`,
    `usedTools=${toolUsage.usedTools.join(',') || '(none)'}`,
    `toolCallCounts=${JSON.stringify(toolUsage.callCounts)}`,
  ].join('\n');
}

function renderEvalCaseTemplates(entry: EvalCase, context: { runId: string }): EvalCase {
  return {
    ...entry,
    capturePaths: entry.capturePaths.map((pattern, index) =>
      renderTemplateString(pattern, context, `capturePaths[${index}]`),
    ),
    objectiveChecks: entry.objectiveChecks.map((check, index) => ({
      ...check,
      command: renderTemplateString(check.command, context, `objectiveChecks[${index}].command`),
    })),
    prompt: renderTemplateString(entry.prompt, context, 'prompt'),
  };
}

function renderTemplateString(
  value: string,
  context: { runId: string },
  fieldPath: string,
): string {
  return value.replaceAll(/{{\s*([^}]+?)\s*}}/g, (match, rawToken: string) => {
    const token = rawToken.trim();

    if (token === 'runId') {
      return context.runId;
    }

    throw new Error(`Unknown eval template token "${token}" in ${fieldPath}: ${match}`);
  });
}

async function captureArtifacts(cwd: string, patterns: string[]) {
  const matches = new Set<string>();

  for (const pattern of patterns) {
    for await (const match of new Bun.Glob(pattern).scan({
      absolute: false,
      cwd,
      dot: true,
      onlyFiles: true,
    })) {
      matches.add(match);
    }
  }

  return await Promise.all(
    [...matches]
      .sort((left, right) => left.localeCompare(right))
      .map(async (relativePath) => ({
        content: await readFile(join(cwd, relativePath), 'utf8'),
        path: relativePath,
      })),
  );
}

async function createTempDir(tempRoot: string): Promise<string> {
  const directory = join(
    resolve(tempRoot),
    `bond-eval-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(directory, { recursive: true });
  return directory;
}

function evaluateFinalResponse(
  matcher: EvalFinalResponseMatcher | undefined,
  finalResponse: string,
): EvalObjectiveCheckResult | undefined {
  if (!matcher) {
    return undefined;
  }

  const passed =
    matcher.type === 'equals'
      ? finalResponse.trim() === matcher.value
      : finalResponse.includes(matcher.value);

  return {
    command: `final_response.${matcher.type}`,
    category: 'final_response',
    details: `Expected final response to ${matcher.type} "${matcher.value}"`,
    exitCode: passed ? 0 : 1,
    name: 'final response',
    passed,
    stderr: '',
    stdout: finalResponse,
  };
}

function evaluateMinSteps(
  minSteps: number | undefined,
  stepsUsed: number,
): EvalObjectiveCheckResult | undefined {
  if (minSteps === undefined) {
    return undefined;
  }

  const passed = stepsUsed >= minSteps;

  return {
    category: 'other',
    command: 'steps_used.minimum',
    details: `Expected at least ${String(minSteps)} step(s); observed ${String(stepsUsed)}`,
    exitCode: passed ? 0 : 1,
    name: 'minimum steps',
    passed,
    stderr: '',
    stdout: String(stepsUsed),
  };
}

function evaluateRequiredTools(
  requiredTools: string[],
  toolUsage: EvalToolUsageSummary,
): EvalObjectiveCheckResult | undefined {
  if (requiredTools.length === 0) {
    return undefined;
  }

  const missingTools = requiredTools.filter((name) => !toolUsage.usedTools.includes(name));
  const passed = missingTools.length === 0;

  return {
    category: 'other',
    command: 'tool_usage.required',
    details: passed
      ? `Observed all required tools: ${requiredTools.join(', ')}`
      : `Missing required tools: ${missingTools.join(', ')}`,
    exitCode: passed ? 0 : 1,
    name: 'required tools',
    passed,
    stderr: '',
    stdout: JSON.stringify({
      callCounts: toolUsage.callCounts,
      missingTools,
      usedTools: toolUsage.usedTools,
    }),
  };
}

function summarizeToolUsage(
  inputItems: unknown[],
  toolTrace: Array<{ name: string }>,
): EvalToolUsageSummary {
  const callCounts =
    toolTrace.length > 0
      ? toolTrace.reduce<Record<string, number>>((counts, entry) => {
          counts[entry.name] = (counts[entry.name] ?? 0) + 1;
          return counts;
        }, {})
      : inputItems.reduce<Record<string, number>>((counts, item) => {
          if (
            !item ||
            typeof item !== 'object' ||
            (Reflect.get(item, 'type') !== 'function_call' &&
              Reflect.get(item, 'type') !== 'custom_tool_call')
          ) {
            return counts;
          }

          const name = Reflect.get(item, 'name');

          if (typeof name === 'string' && name.length > 0) {
            counts[name] = (counts[name] ?? 0) + 1;
          }

          return counts;
        }, {});
  const usedTools = Object.keys(callCounts).sort((left, right) => left.localeCompare(right));

  return { callCounts, usedTools };
}

function evaluateToolUsageChecks(
  checks: EvalCase['toolUsageChecks'],
  toolUsage: EvalToolUsageSummary,
): EvalObjectiveCheckResult[] {
  return checks.map((check) => {
    switch (check.type) {
      case 'all_of': {
        const missingTools = check.tools.filter((tool) => !toolUsage.usedTools.includes(tool));
        const passed = missingTools.length === 0;

        return {
          category: 'other',
          command: `tool_usage.${check.type}`,
          details: passed
            ? `Observed all tools: ${check.tools.join(', ')}`
            : `Missing tools: ${missingTools.join(', ')}`,
          exitCode: passed ? 0 : 1,
          name: check.name,
          passed,
          stderr: '',
          stdout: JSON.stringify({ tools: check.tools, usedTools: toolUsage.usedTools }),
        };
      }
      case 'any_of': {
        const matchedTools = check.tools.filter((tool) => toolUsage.usedTools.includes(tool));
        const passed = matchedTools.length > 0;

        return {
          category: 'other',
          command: `tool_usage.${check.type}`,
          details: passed
            ? `Observed one of: ${matchedTools.join(', ')}`
            : `Observed none of: ${check.tools.join(', ')}`,
          exitCode: passed ? 0 : 1,
          name: check.name,
          passed,
          stderr: '',
          stdout: JSON.stringify({ matchedTools, tools: check.tools }),
        };
      }
      case 'min_calls': {
        const observedCalls = toolUsage.callCounts[check.tool] ?? 0;
        const passed = observedCalls >= check.minCalls;

        return {
          category: 'other',
          command: `tool_usage.${check.type}`,
          details: `Expected at least ${String(check.minCalls)} call(s) to ${check.tool}; observed ${String(observedCalls)}`,
          exitCode: passed ? 0 : 1,
          name: check.name,
          passed,
          stderr: '',
          stdout: JSON.stringify({ observedCalls, tool: check.tool }),
        };
      }
    }
  });
}

async function runObjectiveCheck(
  check: EvalObjectiveCheckSpec,
  options: { cwd: string; shell: string; timeoutMs?: number },
): Promise<EvalObjectiveCheckResult> {
  const child = Bun.spawn([options.shell, '-lc', check.command], {
    cwd: options.cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let timedOut = false;
  const timer =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  const passed =
    !timedOut &&
    exitCode === check.expectExitCode &&
    check.stdoutIncludes.every((needle) => stdout.includes(needle)) &&
    check.stderrIncludes.every((needle) => stderr.includes(needle));

  return {
    category: check.category,
    command: check.command,
    details: timedOut
      ? `timed_out after=${options.timeoutMs}ms exit=${exitCode} expected=${check.expectExitCode}`
      : `exit=${exitCode} expected=${check.expectExitCode}`,
    exitCode,
    name: check.name,
    passed,
    stderr,
    stdout,
  };
}

function readJudgeScore(report: EvalRunReport, judgeId: string): string {
  const match = report.judges.results.find((entry) => entry.id === judgeId);
  return match ? String(match.score) : 'n/a';
}
