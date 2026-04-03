import { describe, expect, test } from 'bun:test';

import { createPlanTool } from '@bond/tools/plan';

describe('createPlanTool', () => {
  const tool = createPlanTool();
  const baseContext = {
    callId: 'call_1',
    cwd: process.cwd(),
    defaultTimeoutMs: 250,
    shell: '/bin/sh',
    workspaceRoot: process.cwd(),
  };

  test('returns structured plan metadata for a valid plan', async () => {
    const result = await tool.execute(
      JSON.stringify({
        explanation: 'Keep the user informed.',
        plan: [
          { status: 'completed', step: 'Inspect the repo' },
          { status: 'in_progress', step: 'Implement the feature' },
          { status: 'pending', step: 'Run verification' },
        ],
      }),
      baseContext,
    );

    expect(result.name).toBe('update_plan');
    expect(result.summary).toBe('steps=3 completed=1 in_progress=1');
    expect(result.content).toContain('<current_plan>');
    expect(result.content).toContain('Explanation: Keep the user informed.');
    expect(result.content).toContain('- [in_progress] Implement the feature');
    expect(result.metadata).toEqual({
      plan: {
        explanation: 'Keep the user informed.',
        steps: [
          { status: 'completed', step: 'Inspect the repo' },
          { status: 'in_progress', step: 'Implement the feature' },
          { status: 'pending', step: 'Run verification' },
        ],
      },
    });
  });

  test('rejects invalid JSON input', async () => {
    await expect(tool.execute('{', baseContext)).rejects.toThrow(
      'update_plan input must be valid JSON',
    );
  });

  test('rejects empty plans', async () => {
    await expect(tool.execute('{"plan":[]}', baseContext)).rejects.toThrow(
      'update_plan input requires at least one plan step',
    );
  });

  test('rejects unknown statuses and multiple in-progress steps', async () => {
    await expect(
      tool.execute('{"plan":[{"step":"Work","status":"blocked"}]}', baseContext),
    ).rejects.toThrow('update_plan plan[0].status must be one of pending, in_progress, completed');

    await expect(
      tool.execute(
        JSON.stringify({
          plan: [
            { status: 'in_progress', step: 'One' },
            { status: 'in_progress', step: 'Two' },
          ],
        }),
        baseContext,
      ),
    ).rejects.toThrow('update_plan input allows at most one in_progress step');
  });
});
