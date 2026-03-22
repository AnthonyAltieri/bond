import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { OpenAIResponsesClient } from '@bond/agent-core';
import {
  OpenAIWebResearcher,
  parseAutoresearchManifest,
  runAutoresearch,
  type AutoresearchManifest,
  type AutoresearchProgressEvent,
  type AutoresearchRunOptions,
  type AutoresearchRunResult,
} from '@bond/autoresearch';
import { OpenAIJudgeProvider } from '@bond/judges';
import { createLocalToolset } from '@bond/tool-registry';

import type { AutoresearchCliConfig } from './config.ts';

interface WritableStreamLike {
  write(chunk: string): void;
}

export interface AutoresearchCommandContext {
  stderr: WritableStreamLike;
  stdout: WritableStreamLike;
}

export interface AutoresearchCommandDependencies {
  loadManifest?: (path: string) => Promise<string>;
  loadProgram?: (path: string) => Promise<string>;
  runAutoresearch?: (
    manifest: AutoresearchManifest,
    program: string,
    options: AutoresearchRunOptions,
  ) => Promise<AutoresearchRunResult>;
}

export async function runAutoresearchCommand(
  config: AutoresearchCliConfig,
  context: AutoresearchCommandContext,
  dependencies: AutoresearchCommandDependencies = {},
): Promise<number> {
  const manifestSource = await (dependencies.loadManifest ?? defaultLoadText)(
    resolve(config.cwd, config.manifestPath),
  );
  const programSource = await (dependencies.loadProgram ?? defaultLoadText)(
    resolve(config.cwd, config.programPath),
  );
  const manifest = await parseAutoresearchManifest(manifestSource);
  const outputDir = resolve(config.cwd, config.outputPath ?? join('.autoresearch', config.tag));
  const result = await (dependencies.runAutoresearch ?? runAutoresearch)(manifest, programSource, {
    browser: new OpenAIWebResearcher({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    }),
    client: new OpenAIResponsesClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
    commandTimeoutMs: config.commandTimeoutMs,
    compactionModel: config.compactionModel,
    forever: config.forever,
    judgeModels: config.judgeModels,
    judgeProvider: new OpenAIJudgeProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
    maxExperiments: config.maxExperiments,
    model: config.model,
    onProgress(event) {
      context.stdout.write(`${formatProgress(event)}\n`);
    },
    outputDir,
    repoRoot: config.cwd,
    resume: config.resume,
    shell: config.shell,
    tag: config.tag,
    tools: createLocalToolset(),
  });

  context.stdout.write(`branch=${result.branchName}\n`);
  context.stdout.write(`frontier=${result.frontierCommit}\n`);
  context.stdout.write(`output=${result.outputDir}\n`);

  return 0;
}

async function defaultLoadText(path: string): Promise<string> {
  return await readFile(path, 'utf8');
}

function formatProgress(event: AutoresearchProgressEvent): string {
  const overallPassRate = event.record.metrics.find(
    (metric) => metric.metric === 'overall_pass_rate',
  );
  return [
    event.type === 'baseline-complete'
      ? 'baseline'
      : `experiment=${String(event.record.experiment).padStart(4, '0')}`,
    `status=${event.record.status}`,
    overallPassRate ? `overall_pass_rate=${overallPassRate.value}` : undefined,
    `summary=${sanitizeProgressSummary(event.record.summary)}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');
}

function sanitizeProgressSummary(summary: string): string {
  return summary.replaceAll('\n', ' ').trim();
}
