import type { AgentEvent, ToolCall } from '@bond/agent-core';

type WritableStream = NodeJS.WriteStream;

interface ToolOutputContext {
  stderr: Pick<WritableStream, 'write'>;
  stdout: Pick<WritableStream, 'write'>;
}

export function handleToolCall(
  context: ToolOutputContext,
  call: ToolCall,
  assistantHasOutput: boolean,
): boolean {
  if (assistantHasOutput) {
    context.stdout.write('\n');
  }

  context.stderr.write(`[tool:${call.name}] ${call.inputText}\n`);
  return false;
}

export function handleToolResult(
  context: ToolOutputContext,
  result: Extract<AgentEvent, { kind: 'tool-result' }>['result'],
): void {
  context.stderr.write(`[tool:${result.name}] ${result.summary}\n`);
}
