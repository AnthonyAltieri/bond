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

  test('describes spawn and wait tools as the subagent workflow surface', () => {
    const toolset = createLocalToolset();
    const spawnTool = toolset.find((tool) => tool.definition.name === 'functions.spawn_agent');
    const waitTool = toolset.find((tool) => tool.definition.name === 'functions.wait_agent');
    const execTool = toolset.find((tool) => tool.definition.name === 'functions.exec_command');
    const stdinTool = toolset.find((tool) => tool.definition.name === 'functions.write_stdin');
    const patchTool = toolset.find((tool) => tool.definition.name === 'functions.apply_patch');
    const imageTool = toolset.find((tool) => tool.definition.name === 'functions.view_image');
    const shellTool = toolset.find((tool) => tool.definition.name === 'shell');

    expect(spawnTool?.definition.description).toContain(
      'Use this when the user asks for subagents, delegation, or parallelized work.',
    );
    expect(waitTool?.definition.description).toContain(
      'so you can gather their exploration or implementation output back into the main thread.',
    );
    expect(execTool?.definition.description).toContain('persistent or interactive process');
    expect(stdinTool?.definition.description).toContain(
      'continue the same live process instead of restarting it',
    );
    expect(patchTool?.definition.description).toContain('instead of shell-based file rewriting');
    expect(imageTool?.definition.description).toContain('inspect its visual contents directly');
    expect(shellTool?.definition.description).toContain(
      'Prefer this for quick one-shot inspection or execution when no more specialized tool fits',
    );
  });
});
