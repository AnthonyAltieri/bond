import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { err, ok, type Result } from '@alt-stack/result';

import { createDeveloperMessage } from '../conversation-state.ts';
import type { ResponseMessageItem } from '../types.ts';
import { PromptScaffoldRepoInstructionsReadError } from './errors.ts';
import type { PromptSectionContext } from './types.ts';

const REPO_INSTRUCTION_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'];

export function createAgentsMdPrompt(
  context: PromptSectionContext,
): Result<ResponseMessageItem | null, PromptScaffoldRepoInstructionsReadError> {
  return readRepoInstructions(context.cwd, context.maxRepoInstructionsChars);
}

function readRepoInstructions(
  cwd: string,
  maxChars: number,
): Result<ResponseMessageItem | null, PromptScaffoldRepoInstructionsReadError> {
  const root = findRepoRoot(cwd);
  const directories = getDirectoriesBetween(root, cwd);
  const sections: string[] = [];
  let length = 0;

  for (const directory of directories) {
    for (const filename of REPO_INSTRUCTION_FILENAMES) {
      const filePath = join(directory, filename);

      if (!existsSync(filePath)) {
        continue;
      }

      let content: string;

      try {
        content = readFileSync(filePath, 'utf8').trim();
      } catch (error) {
        return err(new PromptScaffoldRepoInstructionsReadError(filePath, toErrorMessage(error)));
      }

      if (!content) {
        continue;
      }

      const relativePath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
      const section = [`From ${relativePath}:`, content].join('\n');

      if (length >= maxChars) {
        return ok(
          createDeveloperMessage(['# Repository Instructions', sections.join('\n\n')].join('\n')),
        );
      }

      const remaining = maxChars - length;
      sections.push(
        section.length <= remaining ? section : `${section.slice(0, remaining)}\n...[truncated]`,
      );
      length += section.length;
    }
  }

  if (sections.length === 0) {
    return ok(null);
  }

  return ok(
    createDeveloperMessage(['# Repository Instructions', sections.join('\n\n')].join('\n')),
  );
}

function findRepoRoot(start: string): string {
  let current = resolve(start);

  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      return resolve(start);
    }

    current = parent;
  }
}

function getDirectoriesBetween(root: string, cwd: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);

  while (true) {
    directories.push(current);

    if (current === root) {
      return directories.reverse();
    }

    const parent = dirname(current);

    if (parent === current) {
      return directories.reverse();
    }

    current = parent;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
