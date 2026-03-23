import { describe, expect, test } from 'bun:test';

import { createLocalToolset } from '@bond/tool-registry';

describe('createLocalToolset', () => {
  test('includes shell and update_plan in the default local toolset', () => {
    const toolset = createLocalToolset();

    expect(toolset.map((tool) => tool.definition.name)).toEqual(['shell', 'update_plan']);
  });
});
