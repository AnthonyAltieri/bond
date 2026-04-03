import { describe, expect, test } from 'bun:test';

import { createViewImageTool } from '@bond/tools';

describe('createViewImageTool', () => {
  test('constrains detail to the supported original value in the schema', () => {
    const tool = createViewImageTool();

    expect(tool.definition.kind).toBe('function');

    if (tool.definition.kind !== 'function') {
      throw new Error('expected functions.view_image to be a function tool');
    }

    expect(tool.definition.inputSchema).toEqual({
      additionalProperties: false,
      properties: { detail: { enum: ['original'], type: 'string' }, path: { type: 'string' } },
      required: ['path'],
      type: 'object',
    });
  });
});
