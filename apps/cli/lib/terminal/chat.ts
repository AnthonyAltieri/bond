import type { AgentSessionLike } from '../session.ts';
import type { CliContext } from './context.ts';
import { createUserInputReader, type PromptReader } from './prompt-reader.ts';
import { handleAgentOutput } from './render.ts';

export async function agentLoop(context: CliContext, session: AgentSessionLike): Promise<void> {
  const reader = createUserInputReader(context.stdin, context.stdout);
  context.stdout.write('Interactive mode. Type "exit" or "quit" to leave.\n');

  try {
    while (true) {
      const prompt = await getUserInput(reader);

      if (prompt === undefined || isExitPrompt(prompt)) {
        break;
      }

      if (!prompt) {
        continue;
      }

      await runAgentTurn(context, session, prompt);
    }
  } finally {
    reader.close();
  }
}

export async function runAgentTurn(
  context: CliContext,
  session: AgentSessionLike,
  prompt: string,
): Promise<void> {
  let assistantHasOutput = false;

  for await (const output of session.stream(prompt)) {
    assistantHasOutput = handleAgentOutput(context, output, assistantHasOutput);
  }

  if (assistantHasOutput) {
    context.stdout.write('\n');
  }
}

async function getUserInput(promptReader: PromptReader): Promise<string | undefined> {
  return await promptReader.nextPrompt();
}

function isExitPrompt(prompt: string): boolean {
  return prompt === 'exit' || prompt === 'quit';
}
