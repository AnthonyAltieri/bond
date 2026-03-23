import type { Tool, ToolExecutionContext, ToolExecutionResult } from '@bond/tool-runtime';

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanStep {
  status: PlanStepStatus;
  step: string;
}

export interface PlanSnapshot {
  explanation?: string;
  steps: PlanStep[];
}

interface ParsedPlanInput {
  explanation?: string;
  plan: PlanStep[];
}

export function createPlanTool(): Tool {
  return {
    definition: {
      description:
        'Replace the current task plan with a short structured list of steps and statuses.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          explanation: { type: 'string' },
          plan: {
            items: {
              additionalProperties: false,
              properties: { status: { type: 'string' }, step: { type: 'string' } },
              required: ['step', 'status'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['plan'],
        type: 'object',
      },
      name: 'update_plan',
    },
    async execute(inputText, context) {
      return formatPlanResult(parsePlanInput(inputText), context);
    },
    async *stream(inputText, context) {
      yield* [];
      return formatPlanResult(parsePlanInput(inputText), context);
    },
  };
}

function formatPlanResult(
  input: ParsedPlanInput,
  _context: ToolExecutionContext,
): ToolExecutionResult {
  const snapshot: PlanSnapshot = {
    explanation: input.explanation,
    steps: input.plan.map((entry) => ({ status: entry.status, step: entry.step })),
  };

  const lines = ['<current_plan>'];

  if (snapshot.explanation) {
    lines.push(`Explanation: ${snapshot.explanation}`);
  }

  lines.push('Steps:');
  lines.push(...snapshot.steps.map((entry) => `- [${entry.status}] ${entry.step}`));
  lines.push('</current_plan>');

  return {
    content: lines.join('\n'),
    metadata: { plan: snapshot },
    name: 'update_plan',
    summary: summarizePlan(snapshot),
  };
}

function parsePlanInput(inputText: string): ParsedPlanInput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(inputText);
  } catch {
    throw new Error('update_plan input must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('update_plan input must be an object');
  }

  const explanation = getOptionalString(parsed, 'explanation');
  const plan = getPlanEntries(parsed);

  if (plan.length === 0) {
    throw new Error('update_plan input requires at least one plan step');
  }

  const inProgressCount = plan.filter((entry) => entry.status === 'in_progress').length;

  if (inProgressCount > 1) {
    throw new Error('update_plan input allows at most one in_progress step');
  }

  return { explanation, plan };
}

function getOptionalString(source: object, key: string): string | undefined {
  const value = Reflect.get(source, key);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`update_plan input "${key}" must be a string`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getPlanEntries(source: object): PlanStep[] {
  const value = Reflect.get(source, 'plan');

  if (!Array.isArray(value)) {
    throw new Error('update_plan input "plan" must be an array');
  }

  return value.map((entry, index) => parsePlanEntry(entry, index));
}

function parsePlanEntry(value: unknown, index: number): PlanStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`update_plan plan[${index}] must be an object`);
  }

  const step = Reflect.get(value, 'step');
  const status = Reflect.get(value, 'status');

  if (typeof step !== 'string' || !step.trim()) {
    throw new Error(`update_plan plan[${index}].step must be a non-empty string`);
  }

  if (!isPlanStepStatus(status)) {
    throw new Error(
      `update_plan plan[${index}].status must be one of pending, in_progress, completed`,
    );
  }

  return { status, step: step.trim() };
}

function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function summarizePlan(snapshot: PlanSnapshot): string {
  const inProgress = snapshot.steps.filter((entry) => entry.status === 'in_progress').length;
  const completed = snapshot.steps.filter((entry) => entry.status === 'completed').length;

  return `steps=${snapshot.steps.length} completed=${completed} in_progress=${inProgress}`;
}
