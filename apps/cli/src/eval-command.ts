import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { OpenAIResponsesClient } from '@bond/agent-core';
import {
  formatEvalReportSummary,
  parseEvalManifest,
  runEvalManifest,
  writeEvalReport,
  type EvalManifest,
  type EvalRunReport,
  type RunEvalManifestOptions,
} from '@bond/evals';
import { OpenAIJudgeProvider } from '@bond/judges';
import { createLocalToolset } from '@bond/tool-registry';

import type { EvalCliConfig } from './config.ts';

interface WritableStreamLike {
  write(chunk: string): void;
}

export interface EvalCommandContext {
  stderr: WritableStreamLike;
  stdout: WritableStreamLike;
}

export interface EvalCommandDependencies {
  loadManifest?: (path: string) => Promise<string>;
  runManifest?: (
    manifest: EvalManifest,
    options: RunEvalManifestOptions,
  ) => Promise<EvalRunReport[]>;
  writeReportFile?: (path: string, report: EvalRunReport) => Promise<void>;
}

export async function runEvalCommand(
  config: EvalCliConfig,
  context: EvalCommandContext,
  dependencies: EvalCommandDependencies = {},
): Promise<number> {
  if (!config.runAll && !config.selectedCaseId) {
    throw new Error('`bond eval` requires either --case <id> or --all');
  }

  if (config.runAll && config.selectedCaseId) {
    throw new Error('`bond eval` accepts either --case <id> or --all, not both');
  }

  const manifestSource = await (dependencies.loadManifest ?? defaultLoadManifest)(
    resolve(config.cwd, config.manifestPath),
  );
  const manifest = await parseEvalManifest(manifestSource);
  const reports = await (dependencies.runManifest ?? defaultRunManifest)(manifest, {
    caseIds: config.selectedCaseId ? [config.selectedCaseId] : undefined,
    client: new OpenAIResponsesClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
    commandTimeoutMs: config.commandTimeoutMs,
    judgeModels: config.judgeModels,
    judgeProvider: new OpenAIJudgeProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
    model: config.model,
    repoRoot: config.cwd,
    shell: config.shell,
    tools: createLocalToolset(),
  });

  for (const report of reports) {
    const reportPath = resolveReportPath(config, report, reports.length > 1);
    await (dependencies.writeReportFile ?? writeEvalReport)(reportPath, report);
    context.stdout.write(`${formatEvalReportSummary(report)}\n`);
    context.stdout.write(`report=${reportPath}\n`);
  }

  return reports.every((report) => report.overallPassed) ? 0 : 1;
}

async function defaultLoadManifest(path: string): Promise<string> {
  return await readFile(path, 'utf8');
}

async function defaultRunManifest(
  manifest: EvalManifest,
  options: RunEvalManifestOptions,
): Promise<EvalRunReport[]> {
  return await runEvalManifest(manifest, options);
}

function resolveReportPath(
  config: EvalCliConfig,
  report: EvalRunReport,
  multipleReports: boolean,
): string {
  const stamp = report.startedAt.replaceAll(':', '-');

  if (config.outputPath) {
    const resolvedOutput = resolve(config.cwd, config.outputPath);
    return multipleReports ? join(resolvedOutput, `${report.case.id}.json`) : resolvedOutput;
  }

  return resolve(config.cwd, '.bond', 'evals', `${stamp}-${report.case.id}.json`);
}
