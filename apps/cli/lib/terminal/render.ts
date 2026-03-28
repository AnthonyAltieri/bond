import type { AgentEvent, AgentRunResult, PlanSnapshot, ToolCall } from '@bond/agent';

import type { CliContext } from './context.ts';

export function handleAgentOutput(
  context: CliContext,
  output: AgentEvent,
  assistantHasOutput: boolean,
): boolean {
  switch (output.kind) {
    case 'text-delta':
      context.stdout.write(output.chunk);
      return assistantHasOutput || output.chunk.length > 0;
    case 'reasoning-delta':
      return assistantHasOutput;
    case 'compaction-start':
      return assistantHasOutput;
    case 'compaction-complete':
      return assistantHasOutput;
    case 'plan-update':
      writePlanUpdate(context, output.plan);
      return assistantHasOutput;
    case 'tool-call':
      return writeToolCall(context, output.call, assistantHasOutput);
    case 'tool-stdout':
      return assistantHasOutput;
    case 'tool-stderr':
      return assistantHasOutput;
    case 'tool-result':
      writeToolResult(context, output.result);
      return assistantHasOutput;
    case 'end':
      writeTurnEnd(context, output.result);
      return assistantHasOutput;
  }
}

function writeToolCall(context: CliContext, call: ToolCall, assistantHasOutput: boolean): boolean {
  if (call.name === 'update_plan' || call.name === 'functions.update_plan') {
    return assistantHasOutput;
  }

  if (assistantHasOutput) {
    context.stdout.write('\n');
  }

  context.stderr.write(`[tool:${call.name}] ${call.inputText}\n`);
  return false;
}

function writeToolResult(
  context: CliContext,
  result: Extract<AgentEvent, { kind: 'tool-result' }>['result'],
): void {
  if (result.name === 'update_plan' || result.name === 'functions.update_plan') {
    return;
  }

  context.stderr.write(`[tool:${result.name}] ${result.summary}\n`);
}

function writePlanUpdate(context: CliContext, plan: PlanSnapshot): void {
  const lines = ['[plan]'];

  if (plan.explanation) {
    lines.push(`Explanation: ${plan.explanation}`);
  }

  lines.push(...plan.steps.map((entry) => `- [${entry.status}] ${entry.step}`));
  context.stderr.write(`${lines.join('\n')}\n`);
}

function writeTurnEnd(context: CliContext, result: AgentRunResult): void {
  if (result.stopReason === 'max_steps') {
    context.stderr.write('[agent] stopped after the maximum number of steps\n');
  }
}
