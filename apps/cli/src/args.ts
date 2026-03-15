export interface CliArgs {
  cwd?: string;
  help: boolean;
  maxSteps?: number;
  model?: string;
  prompt?: string;
  timeoutMs?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const promptParts: string[] = [];
  const args: CliArgs = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--model':
        args.model = requireValue(argv, index, token);
        index += 1;
        break;
      case '--max-steps':
        args.maxSteps = parseInteger(requireValue(argv, index, token), token);
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
      default:
        promptParts.push(token);
        break;
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
