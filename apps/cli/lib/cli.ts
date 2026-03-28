import { resolve } from 'node:path';

import { createAutoresearchCliConfig, createEvalCliConfig } from './config/config.ts';
import { parseArgs, type CliArgs } from './config/args.ts';
import {
  runAutoresearchCommand,
  type AutoresearchCommandDependencies,
} from './commands/autoresearch.ts';
import { runEvalCommand, type EvalCommandDependencies } from './commands/eval.ts';
import { buildHelpText } from './help.ts';
import { createSession, type AgentSessionLike, type SessionFactoryOptions } from './session.ts';
import { createCliContext, type CliContextOverrides } from './terminal/context.ts';
import { agentLoop, runAgentTurn } from './terminal/chat.ts';

export interface CliDependencies extends CliContextOverrides {
  autoresearchCommand?: AutoresearchCommandDependencies;
  createSession?: (options: SessionFactoryOptions) => AgentSessionLike;
  cwd?: string;
  env?: Record<string, string | undefined>;
  evalCommand?: EvalCommandDependencies;
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  try {
    const args = parseArgs(argv);
    const context = createCliContext(dependencies);

    if (args.help) {
      context.stdout.write(`${buildHelpText()}\n`);
      return 0;
    }

    if (args.mode === 'eval') {
      return await runEval(args, dependencies, context);
    }

    if (args.mode === 'autoresearch') {
      return await runAutoresearch(args, dependencies, context);
    }

    const runtimeEnv = resolveRuntimeEnv(dependencies);
    const cwd = resolveCliCwd(args, dependencies);
    const session = createSession(args, runtimeEnv, cwd, dependencies.createSession);

    if (args.prompt) {
      await runAgentTurn(context, session, args.prompt);
      return 0;
    }

    await agentLoop(context, session);
    return 0;
  } catch (error) {
    const stderr = dependencies.stderr ?? process.stderr;
    stderr.write(`${toErrorMessage(error)}\n`);
    return 1;
  }
}

async function runEval(
  args: CliArgs,
  dependencies: CliDependencies,
  context: ReturnType<typeof createCliContext>,
): Promise<number> {
  const runtimeEnv = resolveRuntimeEnv(dependencies);
  const cwd = resolveCliCwd(args, dependencies);
  const config = createEvalCliConfig(args, runtimeEnv, cwd);

  return await runEvalCommand(config, context, dependencies.evalCommand);
}

async function runAutoresearch(
  args: CliArgs,
  dependencies: CliDependencies,
  context: ReturnType<typeof createCliContext>,
): Promise<number> {
  const runtimeEnv = resolveRuntimeEnv(dependencies);
  const cwd = resolveCliCwd(args, dependencies);
  const config = createAutoresearchCliConfig(args, runtimeEnv, cwd);

  return await runAutoresearchCommand(config, context, dependencies.autoresearchCommand);
}

function resolveRuntimeEnv(
  dependencies: Pick<CliDependencies, 'env'>,
): Record<string, string | undefined> {
  return dependencies.env ?? process.env;
}

function resolveCliCwd(
  args: Pick<CliArgs, 'cwd'>,
  dependencies: Pick<CliDependencies, 'cwd'>,
): string {
  return resolve(args.cwd ?? dependencies.cwd ?? process.cwd());
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
