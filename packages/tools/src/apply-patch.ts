import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Tool, ToolExecutionContext } from './types.ts';
import { resolveWorkspacePath } from './shared/workspace.ts';

const APPLY_PATCH_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF`;

interface AddFileOperation {
  contentLines: string[];
  kind: 'add';
  path: string;
}

interface DeleteFileOperation {
  kind: 'delete';
  path: string;
}

interface UpdateHunk {
  anchor?: string;
  changes: Array<{ kind: 'add' | 'context' | 'remove'; text: string }>;
  endOfFile: boolean;
}

interface UpdateFileOperation {
  hunks: UpdateHunk[];
  kind: 'update';
  moveTo?: string;
  path: string;
}

type PatchOperation = AddFileOperation | DeleteFileOperation | UpdateFileOperation;

type VirtualEntry = { kind: 'directory' | 'missing' } | { content: string; kind: 'file' };

type VirtualFileEntry = Extract<VirtualEntry, { kind: 'file' }>;

export function createApplyPatchTool(): Tool {
  return {
    definition: {
      description: 'Edit files with a freeform patch.',
      format: { definition: APPLY_PATCH_GRAMMAR, syntax: 'lark', type: 'grammar' },
      kind: 'custom',
      name: 'functions.apply_patch',
    },
    async execute(inputText, context) {
      const operations = parsePatch(inputText);
      const virtualEntries = new Map<string, VirtualEntry>();

      for (const operation of operations) {
        await applyOperation(operation, context, virtualEntries);
      }

      await commitVirtualEntries(virtualEntries);

      const message = `Applied ${String(operations.length)} patch operation(s).`;

      return {
        content: JSON.stringify({ message }, null, 2),
        metadata: { operationCount: operations.length },
        name: 'functions.apply_patch',
        output: message,
        summary: message,
      };
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

async function applyOperation(
  operation: PatchOperation,
  context: ToolExecutionContext,
  virtualEntries: Map<string, VirtualEntry>,
): Promise<void> {
  const sourcePath = resolveWorkspacePath(operation.path, context);

  switch (operation.kind) {
    case 'add': {
      const sourceEntry = await getVirtualEntry(sourcePath, virtualEntries);

      if (sourceEntry.kind !== 'missing') {
        throw new Error(`Cannot add file that already exists: ${operation.path}`);
      }

      virtualEntries.set(sourcePath, {
        content: serializeTextLines(operation.contentLines, true),
        kind: 'file',
      });
      return;
    }
    case 'delete': {
      const sourceEntry = await getVirtualEntry(sourcePath, virtualEntries);

      if (sourceEntry.kind === 'missing') {
        throw new Error(`Cannot delete missing file: ${operation.path}`);
      }

      if (sourceEntry.kind === 'directory') {
        throw new Error(`Cannot delete directory with apply_patch: ${operation.path}`);
      }

      virtualEntries.set(sourcePath, { kind: 'missing' });
      return;
    }
    case 'update': {
      const sourceEntry = await getVirtualEntry(sourcePath, virtualEntries);

      if (sourceEntry.kind === 'missing') {
        throw new Error(`Cannot update missing file: ${operation.path}`);
      }

      if (sourceEntry.kind === 'directory') {
        throw new Error(`Cannot update directory with apply_patch: ${operation.path}`);
      }

      const updatedContent = applyUpdate(
        getFileEntry(sourceEntry, operation.path).content,
        operation,
      );
      const destinationPath = operation.moveTo
        ? resolveWorkspacePath(operation.moveTo, context)
        : sourcePath;

      if (destinationPath !== sourcePath) {
        const destinationEntry = await getVirtualEntry(destinationPath, virtualEntries);

        if (destinationEntry.kind !== 'missing') {
          throw new Error(`Cannot move file onto existing path: ${operation.moveTo}`);
        }

        virtualEntries.set(sourcePath, { kind: 'missing' });
      }

      virtualEntries.set(destinationPath, { content: updatedContent, kind: 'file' });
      return;
    }
  }
}

function applyUpdate(sourceText: string, operation: UpdateFileOperation): string {
  const parsed = parseTextLines(sourceText);
  const lines = [...parsed.lines];
  let cursor = 0;
  let hasTrailingNewline = parsed.hasTrailingNewline;

  for (const hunk of operation.hunks) {
    const baseIndex = hunk.anchor ? findAnchor(lines, hunk.anchor, cursor) + 1 : cursor;
    const oldLines = hunk.changes
      .filter((change) => change.kind !== 'add')
      .map((change) => change.text);
    const newLines = hunk.changes
      .filter((change) => change.kind !== 'remove')
      .map((change) => change.text);

    if (oldLines.length === 0) {
      lines.splice(baseIndex, 0, ...newLines);
      cursor = baseIndex + newLines.length;
    } else {
      const matchIndex = findSequence(lines, oldLines, baseIndex);

      if (matchIndex === -1) {
        throw new Error(`Patch hunk did not match file context for ${operation.path}`);
      }

      lines.splice(matchIndex, oldLines.length, ...newLines);
      cursor = matchIndex + newLines.length;
    }

    if (hunk.endOfFile) {
      hasTrailingNewline = false;
    }
  }

  return serializeTextLines(lines, hasTrailingNewline);
}

async function commitVirtualEntries(virtualEntries: Map<string, VirtualEntry>): Promise<void> {
  const writes = [...virtualEntries.entries()]
    .filter(isVirtualFileEntry)
    .sort(([left], [right]) => left.localeCompare(right));
  const deletes = [...virtualEntries.entries()]
    .filter(([, entry]) => entry.kind === 'missing')
    .sort(([left], [right]) => right.localeCompare(left));

  for (const [path, entry] of writes) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.content, 'utf8');
  }

  for (const [path] of deletes) {
    await rm(path, { force: true });
  }
}

async function getVirtualEntry(
  path: string,
  virtualEntries: Map<string, VirtualEntry>,
): Promise<VirtualEntry> {
  const existingEntry = virtualEntries.get(path);

  if (existingEntry) {
    return existingEntry;
  }

  const fileStat = await stat(path).catch(() => null);

  if (!fileStat) {
    const missingEntry: VirtualEntry = { kind: 'missing' };
    virtualEntries.set(path, missingEntry);
    return missingEntry;
  }

  if (fileStat.isDirectory()) {
    const directoryEntry: VirtualEntry = { kind: 'directory' };
    virtualEntries.set(path, directoryEntry);
    return directoryEntry;
  }

  const fileEntry: VirtualEntry = { content: await readFile(path, 'utf8'), kind: 'file' };
  virtualEntries.set(path, fileEntry);
  return fileEntry;
}

function getFileEntry(entry: VirtualEntry, path: string): VirtualFileEntry {
  if (entry.kind !== 'file') {
    throw new Error(`Expected a file entry for ${path}`);
  }

  return entry;
}

function isVirtualFileEntry(entry: [string, VirtualEntry]): entry is [string, VirtualFileEntry] {
  return entry[1].kind === 'file';
}

function parsePatch(inputText: string): PatchOperation[] {
  const lines = inputText.replace(/\r\n/g, '\n').split('\n');

  if (lines.at(-1) === '') {
    lines.pop();
  }

  if (lines[0] !== '*** Begin Patch') {
    throw new Error('apply_patch input must start with "*** Begin Patch"');
  }

  if (lines.at(-1) !== '*** End Patch') {
    throw new Error('apply_patch input must end with "*** End Patch"');
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length - 1) {
    const line = lines[index];

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length);
      const contentLines: string[] = [];
      index += 1;

      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) {
          throw new Error(`Add file patch lines must start with "+": ${lines[index]}`);
        }

        contentLines.push(lines[index].slice(1));
        index += 1;
      }

      if (contentLines.length === 0) {
        throw new Error(`Add file patch requires content for ${path}`);
      }

      operations.push({ contentLines, kind: 'add', path });
      continue;
    }

    if (line.startsWith('*** Delete File: ')) {
      operations.push({ kind: 'delete', path: line.slice('*** Delete File: '.length) });
      index += 1;
      continue;
    }

    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length);
      let moveTo: string | undefined;
      const hunks: UpdateHunk[] = [];
      index += 1;

      if (lines[index]?.startsWith('*** Move to: ')) {
        moveTo = lines[index].slice('*** Move to: '.length);
        index += 1;
      }

      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        const hunkHeader = lines[index];

        if (hunkHeader !== '@@' && !hunkHeader.startsWith('@@ ')) {
          throw new Error(`Invalid update hunk header: ${hunkHeader}`);
        }

        const hunk: UpdateHunk = {
          anchor: hunkHeader === '@@' ? undefined : hunkHeader.slice(3),
          changes: [],
          endOfFile: false,
        };
        index += 1;

        while (
          index < lines.length - 1 &&
          !lines[index].startsWith('@@') &&
          !lines[index].startsWith('*** ')
        ) {
          const changeLine = lines[index];

          if (changeLine === '*** End of File') {
            hunk.endOfFile = true;
            index += 1;
            continue;
          }

          const prefix = changeLine[0];
          const text = changeLine.slice(1);

          if (prefix === '+') {
            hunk.changes.push({ kind: 'add', text });
          } else if (prefix === '-') {
            hunk.changes.push({ kind: 'remove', text });
          } else if (prefix === ' ') {
            hunk.changes.push({ kind: 'context', text });
          } else {
            throw new Error(`Invalid update hunk line: ${changeLine}`);
          }

          index += 1;
        }

        if (hunk.changes.length === 0) {
          throw new Error(`Update file patch requires changes for ${path}`);
        }

        hunks.push(hunk);
      }

      if (hunks.length === 0) {
        throw new Error(`Update file patch requires at least one hunk for ${path}`);
      }

      operations.push({ hunks, kind: 'update', moveTo, path });
      continue;
    }

    throw new Error(`Unknown patch operation: ${line}`);
  }

  if (operations.length === 0) {
    throw new Error('apply_patch input requires at least one patch hunk');
  }

  return operations;
}

function findAnchor(lines: string[], anchor: string, fromIndex: number): number {
  for (let index = fromIndex; index < lines.length; index += 1) {
    if (lines[index] === anchor) {
      return index;
    }
  }

  throw new Error(`Patch anchor did not match file context: ${anchor}`);
}

function findSequence(lines: string[], target: string[], fromIndex: number): number {
  const preferredMatch = findSequenceFrom(lines, target, fromIndex);

  if (preferredMatch !== -1) {
    return preferredMatch;
  }

  return fromIndex === 0 ? -1 : findSequenceFrom(lines, target, 0);
}

function findSequenceFrom(lines: string[], target: string[], fromIndex: number): number {
  const lastStart = lines.length - target.length;

  for (let index = fromIndex; index <= lastStart; index += 1) {
    let matched = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (lines[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
}

function parseTextLines(content: string): { hasTrailingNewline: boolean; lines: string[] } {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const hasTrailingNewline = normalizedContent.endsWith('\n');
  const strippedContent = hasTrailingNewline ? normalizedContent.slice(0, -1) : normalizedContent;

  return { hasTrailingNewline, lines: strippedContent ? strippedContent.split('\n') : [] };
}

function serializeTextLines(lines: string[], hasTrailingNewline: boolean): string {
  if (lines.length === 0) {
    return '';
  }

  const content = lines.join('\n');
  return hasTrailingNewline ? `${content}\n` : content;
}
