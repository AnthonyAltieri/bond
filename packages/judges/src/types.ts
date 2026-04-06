import { z } from 'zod';

export const JudgeConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const JudgeIssueSeveritySchema = z.enum(['low', 'medium', 'high']);
export const ObjectiveCheckCategorySchema = z.enum([
  'build',
  'content',
  'final_response',
  'runtime',
  'test',
  'other',
]);

export const JudgeIssueSchema = z.object({
  evidence: z.array(z.string()).max(5),
  message: z.string().min(1),
  severity: JudgeIssueSeveritySchema,
});

export const JudgeResultSchema = z.object({
  confidence: JudgeConfidenceSchema,
  issues: z.array(JudgeIssueSchema).max(10),
  pass: z.boolean(),
  score: z.int().min(1).max(5),
  strengths: z.array(z.string()).max(5),
  summary: z.string().min(1),
});

export type JudgeConfidence = z.infer<typeof JudgeConfidenceSchema>;
export type JudgeIssue = z.infer<typeof JudgeIssueSchema>;
export type JudgeIssueSeverity = z.infer<typeof JudgeIssueSeveritySchema>;
export type JudgeResponse = z.infer<typeof JudgeResultSchema>;
export type ObjectiveCheckCategory = z.infer<typeof ObjectiveCheckCategorySchema>;

export interface ChangedFileArtifact {
  content?: string;
  path: string;
  summary?: string;
}

export interface ObjectiveCheckArtifact {
  category: ObjectiveCheckCategory;
  details: string;
  name: string;
  passed: boolean;
}

export interface JudgeInput {
  changedFiles: ChangedFileArtifact[];
  executionSummary?: string;
  finalResponse: string;
  objectiveChecks: ObjectiveCheckArtifact[];
  taskPrompt: string;
}

export interface JudgeSpec {
  focusAreas: string[];
  id: string;
  label: string;
  passThreshold: number;
  rubric: string[];
  weight: number;
}

export interface JudgeRunResult extends JudgeResponse {
  id: string;
  label: string;
  passThreshold: number;
  weight: number;
}

export interface JudgeEnsembleResult {
  blockingIssues: JudgeIssue[];
  combinedSummary: string;
  compositePercent: number;
  compositeScore: number;
  needsHumanReview: boolean;
  passed: boolean;
  results: JudgeRunResult[];
}
