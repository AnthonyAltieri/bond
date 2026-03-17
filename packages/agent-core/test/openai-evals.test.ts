import { describe, expect, test } from 'bun:test';

import { AgentSession, OpenAIResponsesClient, createShellTool } from '@bond/agent-core';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
const hasApiKey = typeof apiKey === 'string' && apiKey.length > 0;
const testIfOpenAIKey = hasApiKey ? test : test.skip;

describe('basic OpenAI loop evals', () => {
  testIfOpenAIKey('uses shell tool for pwd and completes', async () => {
    const result = await runAgentEval([
      'Use the shell tool exactly once to run `pwd`.',
      'Then answer with one line: WORKDIR=<absolute_path>.',
    ].join(' '));

    expect(result.stopReason).toBe('completed');
    expect(result.stepsUsed).toBeGreaterThanOrEqual(2);
    expect(result.inputItems.some((item) => item.type === 'function_call')).toBe(true);
    expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
    expect(result.finalText).toContain('WORKDIR=');
  });

  testIfOpenAIKey('uses shell tool for a fast file count command', async () => {
    const result = await runAgentEval([
      'Use the shell tool exactly once to run this command: `find . -maxdepth 1 -type f | wc -l`.',
      'Then answer with one line: FILE_COUNT=<number>.',
    ].join(' '));

    expect(result.stopReason).toBe('completed');
    expect(result.stepsUsed).toBeGreaterThanOrEqual(2);
    expect(result.inputItems.some((item) => item.type === 'function_call')).toBe(true);
    expect(result.inputItems.some((item) => item.type === 'function_call_output')).toBe(true);
    expect(result.finalText).toContain('FILE_COUNT=');
  });
});

async function runAgentEval(prompt: string) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for evals');
  }

  const client = new OpenAIResponsesClient({ apiKey, baseUrl: process.env.OPENAI_BASE_URL });
  const session = new AgentSession({
    client,
    cwd: process.cwd(),
    maxSteps: 4,
    model,
    tools: [createShellTool()],
  });

  return session.run(prompt);
}
