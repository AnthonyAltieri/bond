import { describe, expect, test } from 'bun:test';

import {
  createDefaultToolServices,
  createExecCommandTool,
  createInMemoryExecSessionManager,
  createWriteStdinTool,
} from '@bond/tools';

const toolServices = createDefaultToolServices({
  execSessions: createInMemoryExecSessionManager(),
});

const baseContext = {
  callId: 'call_exec',
  cwd: process.cwd(),
  defaultTimeoutMs: 250,
  services: toolServices,
  shell: '/bin/sh',
  workspaceRoot: process.cwd(),
} as const;

describe('exec tools', () => {
  test('runs a command and returns Codex-style output metadata', async () => {
    const tool = createExecCommandTool(toolServices);
    const result = await tool.execute('{"cmd":"printf hello","yield_time_ms":50}', baseContext);

    expect(result.name).toBe('functions.exec_command');
    expect(result.content).toContain('"output": "hello"');
    expect(result.content).toContain('"exitCode": 0');
  });

  test('supports interactive sessions through write_stdin', async () => {
    const execTool = createExecCommandTool(toolServices);
    const stdinTool = createWriteStdinTool(toolServices);
    const started = await execTool.execute(
      '{"cmd":"read foo; printf \\"$foo\\"","yield_time_ms":10}',
      baseContext,
    );
    const startedPayload = JSON.parse(started.content) as { sessionId?: number };

    expect(startedPayload.sessionId).toBeTypeOf('number');

    const finished = await stdinTool.execute(
      JSON.stringify({ chars: 'bond\n', session_id: startedPayload.sessionId, yield_time_ms: 10 }),
      baseContext,
    );

    expect(finished.content).toContain('"output": "bond"');
    expect(finished.content).toContain('"exitCode": 0');
  });
});
