import { describe, expect, test } from 'bun:test';

import { createShellTool } from '@bond/agent-core';

describe('createShellTool', () => {
  const tool = createShellTool();
  const baseContext = {
    callId: 'call_1',
    cwd: process.cwd(),
    defaultTimeoutMs: 250,
    workspaceRoot: process.cwd(),
  };

  test('captures stdout for a successful command', async () => {
    const result = await tool.execute('{"command":"printf hello"}', baseContext);
    expect(result.content).toContain('"stdout": "hello"');
    expect(result.content).toContain('"exitCode": 0');
  });

  test('captures failures without throwing', async () => {
    const result = await tool.execute('{"command":"exit 5"}', baseContext);
    expect(result.content).toContain('"exitCode": 5');
    expect(result.summary).toContain('exit=5');
  });

  test('marks timed out commands', async () => {
    const result = await tool.execute('{"command":"sleep 1","timeoutMs":10}', baseContext);
    expect(result.content).toContain('"timedOut": true');
  });
});
