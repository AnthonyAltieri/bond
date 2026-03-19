import { describe, expect, test } from 'bun:test';

import { createLocalToolset } from '@bond/tool-registry';

describe('createLocalToolset', () => {
  test('includes the shell tool in the default local toolset', () => {
    const toolset = createLocalToolset();

    expect(toolset).toHaveLength(1);
    expect(toolset[0]?.definition.name).toBe('shell');
  });
});
