export interface CliArgs {
  autoCompactTokens?: number;
  caseId?: string;
  compactionModel?: string;
  cwd?: string;
  forever: boolean;
  help: boolean;
  judgeModel?: string;
  judgeModelArchitecture?: string;
  judgeModelCorrectness?: string;
  judgeModelGoal?: string;
  judgeModelSimplicity?: string;
  manifestPath?: string;
  maxExperiments?: number;
  maxSteps?: number;
  model?: string;
  mode: 'autoresearch' | 'chat' | 'eval';
  outputPath?: string;
  programPath?: string;
  prompt?: string;
  resume: boolean;
  runAll: boolean;
  tag?: string;
  timeoutMs?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const promptParts: string[] = [];
  const args: CliArgs = { forever: false, help: false, mode: 'chat', resume: false, runAll: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (index === 0 && token === 'eval') {
      args.mode = 'eval';
      continue;
    }

    if (index === 0 && token === 'autoresearch') {
      args.mode = 'autoresearch';
      continue;
    }

    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--model':
        args.model = requireValue(argv, index, token);
        index += 1;
        break;
      case '--compaction-model':
        args.compactionModel = requireValue(argv, index, token);
        index += 1;
        break;
      case '--max-steps':
        args.maxSteps = parseInteger(requireValue(argv, index, token), token);
        index += 1;
        break;
      case '--auto-compact-tokens':
        args.autoCompactTokens = parseInteger(requireValue(argv, index, token), token);
        index += 1;
        break;
      case '--timeout':
        args.timeoutMs = parseInteger(requireValue(argv, index, token), token);
        index += 1;
        break;
      case '--cwd':
        args.cwd = requireValue(argv, index, token);
        index += 1;
        break;
      case '--manifest':
        args.manifestPath = requireValue(argv, index, token);
        index += 1;
        break;
      case '--program':
        args.programPath = requireValue(argv, index, token);
        index += 1;
        break;
      case '--case':
        args.caseId = requireValue(argv, index, token);
        index += 1;
        break;
      case '--all':
        args.runAll = true;
        break;
      case '--forever':
        args.forever = true;
        break;
      case '--resume':
        args.resume = true;
        break;
      case '--output':
        args.outputPath = requireValue(argv, index, token);
        index += 1;
        break;
      case '--max-experiments':
        args.maxExperiments = parseInteger(requireValue(argv, index, token), token);
        index += 1;
        break;
      case '--tag':
        args.tag = requireValue(argv, index, token);
        index += 1;
        break;
      case '--judge-model':
        args.judgeModel = requireValue(argv, index, token);
        index += 1;
        break;
      case '--judge-model-architecture':
        args.judgeModelArchitecture = requireValue(argv, index, token);
        index += 1;
        break;
      case '--judge-model-correctness':
        args.judgeModelCorrectness = requireValue(argv, index, token);
        index += 1;
        break;
      case '--judge-model-simplicity':
        args.judgeModelSimplicity = requireValue(argv, index, token);
        index += 1;
        break;
      case '--judge-model-goal':
        args.judgeModelGoal = requireValue(argv, index, token);
        index += 1;
        break;
      default:
        if (args.mode === 'chat') {
          promptParts.push(token);
          break;
        }

        throw new Error(`Unknown argument: ${token}`);
    }
  }

  const prompt = promptParts.join(' ').trim();

  if (prompt) {
    args.prompt = prompt;
  }

  return args;
}

function parseInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function requireValue(argv: string[], index: number, flagName: string): string {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${flagName} requires a value`);
  }

  return value;
}
