import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApplyPatchTool } from '@bond/tools';

describe('createApplyPatchTool', () => {
  let workspaceRoot: string | undefined;

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
      workspaceRoot = undefined;
    }
  });

  test('adds and updates files from a freeform patch', async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'bond-apply-patch-'));
    const tool = createApplyPatchTool();
    const context = {
      callId: 'call_patch',
      cwd: workspaceRoot,
      defaultTimeoutMs: 250,
      shell: '/bin/sh',
      workspaceRoot,
    };
    const addPatch = `*** Begin Patch
*** Add File: hello.txt
+Hello world
*** End Patch`;

    await tool.execute(addPatch, context);
    expect(await readFile(join(workspaceRoot, 'hello.txt'), 'utf8')).toBe('Hello world\n');

    const updatePatch = `*** Begin Patch
*** Update File: hello.txt
@@
-Hello world
+Final text
*** End Patch`;

    await tool.execute(updatePatch, context);
    expect(await readFile(join(workspaceRoot, 'hello.txt'), 'utf8')).toBe('Final text\n');
  });

  test('moves files when requested', async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'bond-apply-patch-'));
    await writeFile(join(workspaceRoot, 'source.txt'), 'before\n', 'utf8');
    const tool = createApplyPatchTool();
    const context = {
      callId: 'call_patch_move',
      cwd: workspaceRoot,
      defaultTimeoutMs: 250,
      shell: '/bin/sh',
      workspaceRoot,
    };
    const movePatch = `*** Begin Patch
*** Update File: source.txt
*** Move to: nested/dest.txt
@@
-before
+after
*** End Patch`;

    await tool.execute(movePatch, context);
    expect(await readFile(join(workspaceRoot, 'nested/dest.txt'), 'utf8')).toBe('after\n');
  });
});
