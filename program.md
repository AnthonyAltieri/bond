# Bond Autoresearch Program

Your job is to improve Bond as a coding agent.

## Objective

Increase Bond's coding eval performance first. Favor changes that improve:

- eval pass rate
- objective pass rate
- correctness scoring
- robustness of tool use and recovery

## Strategy

- Use web research when it can uncover concrete ideas, reference implementations, or official guidance that may improve Bond's coding behavior.
- Favor small, testable changes over broad refactors.
- Prefer improvements to prompts, orchestration, tool use, verification behavior, and eval coverage before architectural churn.
- If a change broadens scope or complexity, it must have a plausible path to better coding eval outcomes.
- Treat persistent failures in required evaluation sources as the highest-priority bottleneck.
- If several recent no-gain experiments touched the same files, switch to a different locus unless new external evidence supports a materially different approach there.
- Prefer edits that are plausibly connected to current failing evals over self-referential prompt wording tweaks.

## Constraints

- Do not change the scoring rules, rank order, or editable scope by editing `autoresearch.json`.
- Do not optimize for style or docs unless it is directly tied to better coding-agent behavior.
- Avoid dependency churn unless it is clearly necessary.
- Make exactly one focused experimental change per run.
- Do not keep editing `packages/agent-core/src/system-prompt.ts` by default when recent prompt-only experiments have failed to move the frontier.

## Research Focus Areas

- system prompt clarity
- tool call sequencing and recovery
- verification discipline
- eval quality and benchmark realism
- shell tool ergonomics and guardrails

## Success Heuristic

If you find a plausible improvement from docs, issues, or examples, try the smallest credible version of it and rely on local evals to determine whether it helped.
