import { describe, expect, test } from 'bun:test';

import { createLocalToolset } from '@bond/tools';

describe('createLocalToolset', () => {
  test('includes the Codex-style local tool surface in the default local toolset', () => {
    const toolset = createLocalToolset();

    expect(toolset.map((tool) => tool.definition.name)).toEqual([
      'shell',
      'update_plan',
      'functions.update_plan',
      'functions.exec_command',
      'functions.write_stdin',
      'functions.apply_patch',
      'functions.view_image',
      'functions.list_mcp_resources',
      'functions.list_mcp_resource_templates',
      'functions.read_mcp_resource',
      'functions.spawn_agent',
      'functions.send_input',
      'functions.resume_agent',
      'functions.wait_agent',
      'functions.close_agent',
      'multi_tool_use.parallel',
    ]);
  });
});
