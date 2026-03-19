import type { JudgeProvider, JudgeProviderRequest } from './judge-runner.ts';
import type { z } from 'zod';
import { z as zod } from 'zod';

interface OpenAIJudgeProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

interface OpenAIJudgeResponse {
  error?: { message?: string };
  output?: unknown;
  output_text?: string;
}

const ResponseOutputTextSchema = zod.object({
  content: zod.array(
    zod.object({
      text: zod.string().optional(),
      type: zod.string(),
    }),
  ),
  type: zod.string(),
});

export class OpenAIJudgeProvider implements JudgeProvider {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  constructor(options: OpenAIJudgeProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async evaluate<TSchema extends z.ZodType>(
    request: JudgeProviderRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      body: JSON.stringify({
        input: [
          {
            content: [{ text: request.instructions, type: 'input_text' }],
            role: 'developer',
            type: 'message',
          },
          {
            content: [{ text: request.input, type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
        ],
        model: request.model,
        text: {
          format: {
            name: 'judge_result',
            schema: zod.toJSONSchema(request.schema),
            strict: true,
            type: 'json_schema',
          },
        },
      }),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(await formatOpenAIJudgeError(response));
    }

    const payload = (await response.json()) as OpenAIJudgeResponse;
    const outputText = readOutputText(payload);

    if (!outputText) {
      throw new Error('OpenAI judge response did not include output text');
    }

    return request.schema.parse(JSON.parse(outputText)) as z.infer<TSchema>;
  }
}

async function formatOpenAIJudgeError(response: Response): Promise<string> {
  const bodyText = await response.text();

  try {
    const parsed = JSON.parse(bodyText) as OpenAIJudgeResponse;
    const message = parsed.error?.message;

    if (message) {
      return `OpenAI judge request failed (${response.status}): ${message}`;
    }
  } catch {
    // Fall through to the raw response body.
  }

  return `OpenAI judge request failed (${response.status}): ${bodyText}`;
}

function readOutputText(response: OpenAIJudgeResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  if (!Array.isArray(response.output)) {
    return '';
  }

  return response.output
    .flatMap((item) => {
      const parsed = ResponseOutputTextSchema.safeParse(item);

      if (!parsed.success) {
        return [];
      }

      return parsed.data.content
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text ?? '');
    })
    .join('');
}
