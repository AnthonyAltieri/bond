type ReadableStream = NodeJS.ReadStream;
type WritableStream = NodeJS.WriteStream;

export interface CliContext {
  stderr: Pick<WritableStream, 'write'>;
  stdin: ReadableStream;
  stdout: Pick<WritableStream, 'write'>;
}

export interface CliContextOverrides {
  stderr?: Pick<WritableStream, 'write'>;
  stdin?: ReadableStream;
  stdout?: Pick<WritableStream, 'write'>;
}

export function createCliContext(overrides: CliContextOverrides = {}): CliContext {
  return {
    stderr: overrides.stderr ?? process.stderr,
    stdin: overrides.stdin ?? process.stdin,
    stdout: overrides.stdout ?? process.stdout,
  };
}
