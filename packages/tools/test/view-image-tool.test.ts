import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createViewImageTool } from '@bond/tools';

describe('createViewImageTool', () => {
  let workspaceRoot: string | undefined;

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
      workspaceRoot = undefined;
    }
  });

  test('returns an input_image payload', async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'bond-view-image-'));
    const filePath = join(workspaceRoot, 'tiny.png');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XgnsAAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(filePath, pngBytes);
    const tool = createViewImageTool();
    const result = await tool.execute(JSON.stringify({ detail: 'original', path: filePath }), {
      callId: 'call_view',
      cwd: workspaceRoot,
      defaultTimeoutMs: 250,
      shell: '/bin/sh',
      workspaceRoot,
    });

    expect(result.output).toEqual([
      {
        detail: 'original',
        image_url: expect.stringContaining('data:image/png;base64,'),
        type: 'input_image',
      },
    ]);
  });
});
