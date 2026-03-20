import type { WebResearchRequest, WebResearchResult, WebResearcher } from './autoresearch-runner.ts';
import { z } from 'zod';

interface OpenAIWebResearcherOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

interface OpenAIResearchResponse {
  error?: { message?: string };
  output?: unknown;
  output_text?: string;
}

const ResponseOutputTextSchema = z.object({
  content: z.array(
    z.object({
      text: z.string().optional(),
      type: z.string(),
    }),
  ),
  type: z.string(),
});

const WebResearchResultSchema = z.object({
  ideas: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1),
  sources: z
    .array(
      z.object({
        title: z.string().min(1).nullable(),
        url: z.string().min(1),
      }),
    )
    .default([]),
});

export class OpenAIWebResearcher implements WebResearcher {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly model: string;

  constructor(options: OpenAIWebResearcherOptions) {
    if (!options.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model;
  }

  async research(request: WebResearchRequest): Promise<WebResearchResult> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      body: JSON.stringify({
        input: [
          {
            content: [{ text: buildResearchInstructions(request), type: 'input_text' }],
            role: 'developer',
            type: 'message',
          },
          {
            content: [{ text: buildResearchPrompt(request), type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
        ],
        model: this.model,
        text: {
          format: {
            name: 'web_research_result',
            schema: z.toJSONSchema(WebResearchResultSchema),
            strict: true,
            type: 'json_schema',
          },
        },
        tools: [{ type: 'web_search' }],
      }),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(await formatOpenAIResearchError(response));
    }

    const payload = (await response.json()) as OpenAIResearchResponse;
    const outputText = readOutputText(payload);

    if (!outputText) {
      throw new Error('OpenAI web research response did not include output text');
    }

    return WebResearchResultSchema.parse(JSON.parse(outputText)) satisfies WebResearchResult;
  }
}

function buildResearchInstructions(request: WebResearchRequest): string {
  return [
    'You are researching ways to improve Bond as a coding agent.',
    'Use web search to gather up-to-date implementation ideas, docs, issue threads, and examples.',
    'Return strict JSON only.',
    request.domainsAllowlist.length > 0
      ? `Only use sources from these domains when possible: ${request.domainsAllowlist.join(', ')}`
      : 'Prefer primary sources, official docs, and concrete implementation references.',
  ].join('\n');
}

function buildResearchPrompt(request: WebResearchRequest): string {
  const hotspotPaths = summarizeRecentHotspots(request.recentExperiments);

  return [
    '# Current Frontier',
    request.frontierSummary,
    '',
    '# Recent Experiments',
    request.recentExperiments.length > 0
      ? request.recentExperiments
          .map((experiment) => `- ${experiment.status}: ${experiment.summary}`)
          .join('\n')
      : '- none',
    '',
    '# Recent No-Gain Hotspots',
    hotspotPaths.length > 0 ? hotspotPaths.map((path) => `- ${path}`).join('\n') : '- none',
    '',
    '# Research Program',
    request.program,
    '',
    '# Repo Context',
    `repo_root=${request.repoContext}`,
    '',
    '# Task',
    `Gather up to ${request.maxQueries} concrete ideas that could improve Bond on coding evals.`,
    'Focus on prompt design, tool-use behavior, recovery patterns, eval design, and coding-agent architecture.',
    hotspotPaths.length > 0
      ? 'Prefer ideas outside the recent no-gain hotspots unless the external evidence suggests a materially different approach there.'
      : 'Prefer ideas that address the most important current bottlenecks first.',
    'Provide a concise synthesis, a short list of candidate ideas, and the source URLs you used.',
  ].join('\n');
}

function summarizeRecentHotspots(recentExperiments: WebResearchRequest['recentExperiments']): string[] {
  const counts = new Map<string, number>();

  for (const experiment of recentExperiments) {
    for (const path of experiment.changedPaths ?? []) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([path, count]) => `${path} (${count}x)`);
}

async function formatOpenAIResearchError(response: Response): Promise<string> {
  const bodyText = await response.text();

  try {
    const parsed = JSON.parse(bodyText) as OpenAIResearchResponse;
    const message = parsed.error?.message;

    if (message) {
      return `OpenAI web research request failed (${response.status}): ${message}`;
    }
  } catch {
    // Ignore JSON parsing failures and fall through to the raw body.
  }

  return `OpenAI web research request failed (${response.status}): ${bodyText}`;
}

function readOutputText(response: OpenAIResearchResponse): string {
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
