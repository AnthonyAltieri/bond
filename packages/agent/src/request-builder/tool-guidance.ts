import { ok, type Result } from '@alt-stack/result';

import { createDeveloperMessage } from '../conversation-state.ts';
import type { ResponseMessageItem } from '../types.ts';
import type { PromptSectionContext } from './types.ts';

export function createToolGuidancePrompt(
  context: PromptSectionContext,
): Result<ResponseMessageItem | null, never> {
  if (context.toolDefinitions.length === 0) {
    return ok(null);
  }

  const toolNames = new Set(context.toolDefinitions.map((tool) => tool.name));
  const lines = [
    '# Tool Guidance',
    '- Tool schemas are available in the API tool definitions; use this guidance for behavior and selection rules.',
    ...createSelectionHeuristics(toolNames),
    ...createDelegationGuidance(toolNames),
    ...createParallelToolGuidance(toolNames),
  ];

  return ok(createDeveloperMessage(lines.join('\n')));
}

function createSelectionHeuristics(toolNames: ReadonlySet<string>): string[] {
  const lines = [
    '',
    '# Tool Selection Heuristics',
    '- Prefer the most specialized tool that directly matches the user request or artifact you need to inspect; use shell as a fallback rather than the default.',
    '- Choose the path that is most likely to succeed with the fewest retries and least repeated probing.',
  ];

  if (toolNames.has('functions.view_image')) {
    lines.push(
      '- When the user asks what a badge, logo, screenshot, mockup, or other image shows, use functions.view_image instead of guessing from filenames or shell metadata.',
    );
  }

  if (toolNames.has('functions.apply_patch')) {
    lines.push(
      '- When the user wants you to create, edit, update, or patch files, prefer functions.apply_patch over shell-based rewriting.',
    );
  }

  if (toolNames.has('functions.exec_command')) {
    lines.push(
      '- When the task implies a persistent or interactive program, use functions.exec_command to start it instead of repeatedly launching one-shot shell commands.',
    );
  }

  if (toolNames.has('functions.write_stdin')) {
    lines.push(
      '- After starting an interactive session, continue the same process with functions.write_stdin instead of restarting it.',
    );
  }

  if (
    toolNames.has('functions.list_mcp_resources') ||
    toolNames.has('functions.read_mcp_resource')
  ) {
    lines.push(
      '- When repository-local context is exposed through MCP resources or templates, prefer those direct reads over shell discovery or web lookups.',
    );
  }

  return lines;
}

function createDelegationGuidance(toolNames: ReadonlySet<string>): string[] {
  if (!toolNames.has('functions.spawn_agent')) {
    return [];
  }

  const lines = [
    '',
    '# Delegation Guidance',
    '- Use functions.spawn_agent when there is independent work you can hand off without blocking your immediate next step.',
    '- If the user asks to use subagents, helper agents, parallelize the task, delegate, split investigations, fan work out, or do research in parallel, treat that as explicit permission to spawn child agents.',
    '- Prefer parallel child agents for exploration, verification, or implementation slices with disjoint scope.',
    '- Keep each child task narrow and concrete so the result is easy to integrate.',
  ];

  if (toolNames.has('functions.wait_agent')) {
    lines.push(
      '- Do not wait by default; use functions.wait_agent only when the main thread is genuinely blocked on the child result.',
      '- After child agents finish their exploration or implementation slices, use functions.wait_agent to gather the results back when you are ready to integrate them.',
      '- Call functions.spawn_agent and functions.wait_agent directly; do not wrap child-agent lifecycle calls in multi_tool_use.parallel.',
    );
  }

  if (toolNames.has('functions.send_input')) {
    lines.push(
      '- Use functions.send_input to refine or extend an existing child agent instead of spawning a duplicate task.',
    );
  }

  return lines;
}

function createParallelToolGuidance(toolNames: ReadonlySet<string>): string[] {
  if (!toolNames.has('multi_tool_use.parallel')) {
    return [];
  }

  return [
    '',
    '# Parallel Tool Guidance',
    '- Use multi_tool_use.parallel for safe independent tool calls that can run together, especially non-mutating inspection work before implementation.',
    '- Do not use multi_tool_use.parallel to orchestrate child-agent lifecycle calls; call functions.spawn_agent and functions.wait_agent directly.',
    '- If the task explicitly names multi_tool_use.parallel or provides an exact wrapper payload, call the wrapper directly instead of substituting equivalent direct tool calls.',
    '- When multiple allowed inspection calls are known up front, prefer one multi_tool_use.parallel call over issuing them serially.',
    '- Payload shape example: {"tool_uses":[{"recipient_name":"shell","parameters":{"command":"pwd"}},{"recipient_name":"shell","parameters":{"command":"ls"}}]}',
  ];
}
