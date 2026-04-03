import { TaggedError } from '@alt-stack/result';

export class PromptScaffoldRepoInstructionsReadError extends TaggedError<'PromptScaffoldRepoInstructionsReadError'> {
  readonly _tag = 'PromptScaffoldRepoInstructionsReadError';

  constructor(
    public readonly filePath: string,
    public readonly reason: string,
  ) {
    super(`Failed to read repo instructions from ${filePath}: ${reason}`);
  }
}

export class PromptScaffoldInvalidExecutionContextError extends TaggedError<'PromptScaffoldInvalidExecutionContextError'> {
  readonly _tag = 'PromptScaffoldInvalidExecutionContextError';

  constructor(public readonly value: string) {
    super(`Execution context requires a valid date, received ${value}.`);
  }
}

export class PromptScaffoldInvalidUserInputError extends TaggedError<'PromptScaffoldInvalidUserInputError'> {
  readonly _tag = 'PromptScaffoldInvalidUserInputError';

  constructor() {
    super('Prompt builder expected a user message with only input_text content.');
  }
}

export type PromptScaffoldError =
  | PromptScaffoldInvalidExecutionContextError
  | PromptScaffoldInvalidUserInputError
  | PromptScaffoldRepoInstructionsReadError;
