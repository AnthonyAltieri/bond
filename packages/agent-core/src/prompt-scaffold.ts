import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createDeveloperMessage, createUserMessage } from './conversation-state.ts';
import type { ResponseInputItem } from './types.ts';

const DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS = 32 * 1024;
const REPO_INSTRUCTION_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'];

const DEFAULT_PERMISSIONS_INSTRUCTIONS = [
  '<permissions instructions>',
  '- You are running inside a local CLI agent harness.',
  '- You may use the shell tool to inspect and modify files inside the workspace.',
  '- Prefer direct, minimal commands that help complete the current task.',
  '- Respect repo instructions and avoid unnecessary tool calls.',
  '</permissions instructions>',
].join('\n');

export interface PromptScaffoldOptions {
  cwd: string;
  maxRepoInstructionsChars?: number;
  shell: string;
}

export function buildPromptScaffold(options: PromptScaffoldOptions): ResponseInputItem[] {
  const items: ResponseInputItem[] = [createDeveloperMessage(DEFAULT_PERMISSIONS_INSTRUCTIONS)];
  const repoInstructions = readRepoInstructions(
    options.cwd,
    options.maxRepoInstructionsChars ?? DEFAULT_MAX_REPO_INSTRUCTIONS_CHARS,
  );

  if (repoInstructions) {
    items.push(createDeveloperMessage(repoInstructions));
  }

  items.push(createUserMessage(formatEnvironmentContext(options.cwd, options.shell)));
  return items;
}

function formatEnvironmentContext(cwd: string, shell: string): string {
  return [
    '<environment_context>',
    `  <cwd>${cwd}</cwd>`,
    `  <shell>${shell}</shell>`,
    '</environment_context>',
  ].join('\n');
}

function readRepoInstructions(cwd: string, maxChars: number): string | undefined {
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

      const relativePath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
      const content = readFileSync(filePath, 'utf8').trim();

      if (!content) {
        continue;
      }

      const section = [`From ${relativePath}:`, content].join('\n');

      if (length >= maxChars) {
        return sections.join('\n\n');
      }

      const remaining = maxChars - length;
      sections.push(
        section.length <= remaining ? section : `${section.slice(0, remaining)}\n...[truncated]`,
      );
      length += section.length;
    }
  }

  if (sections.length === 0) {
    return undefined;
  }

  return ['<repo_instructions>', sections.join('\n\n'), '</repo_instructions>'].join('\n');
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
