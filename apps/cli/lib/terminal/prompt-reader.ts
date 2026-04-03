import { createInterface } from 'node:readline/promises';

type ReadableStream = NodeJS.ReadStream;

interface WritableStreamLike {
  write(chunk: string): void;
}

export interface PromptReader {
  close: () => void;
  nextPrompt: () => Promise<string | undefined>;
}

export function createUserInputReader(
  stdin: ReadableStream,
  stdout: WritableStreamLike,
): PromptReader {
  const readline = createInterface({ input: stdin, terminal: false });
  const iterator = readline[Symbol.asyncIterator]();

  return {
    close() {
      readline.close();
    },
    async nextPrompt() {
      stdout.write('> ');
      const next = await iterator.next();

      return next.done ? undefined : next.value.trim();
    },
  };
}
