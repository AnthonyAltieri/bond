import type { JudgeSpec } from './types.ts';

export const ARCHITECTURE_CRITIC: JudgeSpec = {
  focusAreas: [
    'Separation of concerns',
    'Fit with repository conventions',
    'Maintainability and extension points',
    'Avoidance of brittle or tangled coupling',
  ],
  id: 'architecture_critic',
  label: 'Architecture Critic',
  passThreshold: 3,
  rubric: [
    'Prefer modular changes that match existing abstractions.',
    'Penalize hidden coupling, leaky interfaces, and duplicated logic.',
    'Reward solutions that make future evaluation or provider expansion easier.',
  ],
  weight: 0.25,
};

export const SIMPLICITY_CRITIC: JudgeSpec = {
  focusAreas: [
    'Minimal code surface area',
    'Avoidance of unnecessary abstractions',
    'Clarity over cleverness',
    'Scope discipline',
  ],
  id: 'simplicity_critic',
  label: 'Simplicity Critic',
  passThreshold: 3,
  rubric: [
    'Penalize over-engineering, unnecessary indirection, and inflated code size.',
    'Reward the smallest correct solution that remains readable and testable.',
    'Treat speculative complexity as a negative unless it clearly enables the stated goal.',
  ],
  weight: 0.15,
};

export const GOAL_CRITIC: JudgeSpec = {
  focusAreas: [
    'Faithfulness to the user prompt',
    'Behavioral correctness relative to requested outcomes',
    'Completeness of the implementation',
    'Alignment with objective verification evidence',
  ],
  id: 'goal_critic',
  label: 'Goal Critic',
  passThreshold: 4,
  rubric: [
    'Use the objective verification results as ground truth when available.',
    'Penalize missing requested behavior, ignored constraints, or mismatched outputs.',
    'Fail harshly when the final result does not satisfy the prompt even if the code quality is otherwise high.',
  ],
  weight: 0.35,
};

export const CORRECTNESS_CRITIC: JudgeSpec = {
  focusAreas: [
    'Use of tests and runtime checks as behavioral evidence',
    'Alignment between observed verification results and claimed correctness',
    'Likelihood the delivered solution actually works for the requested behavior',
    'Confidence calibration when evidence is weak or missing',
  ],
  id: 'correctness_critic',
  label: 'Correctness Critic',
  passThreshold: 4,
  rubric: [
    'Treat test and runtime verification results as the strongest correctness evidence when they are available.',
    'Penalize solutions that claim success without meaningful verification, especially when behavior is complex or executable.',
    'If tests or runtime checks fail, score correctness harshly even if the code looks plausible.',
  ],
  weight: 0.25,
};

export const DEFAULT_JUDGE_SPECS = [
  ARCHITECTURE_CRITIC,
  SIMPLICITY_CRITIC,
  GOAL_CRITIC,
  CORRECTNESS_CRITIC,
];
