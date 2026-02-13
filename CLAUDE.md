# CLAUDE.md

Purpose: Ship high-quality code fast with minimal token usage.

## Mission
- Optimize for `correctness`, `speed`, and `low-token communication`.
- Prefer minimal, production-safe changes over broad refactors.
- Default to implementation, not discussion.

## Non-Negotiables
- Never guess requirements when a quick check can confirm them.
- Never ship unverified behavior when verification is possible.
- Never add complexity without measurable benefit.
- Never output long explanations when a short actionable answer is enough.

## Execution Loop (Default)
1. Define the target outcome and acceptance criteria in 1-3 lines.
2. Inspect only relevant files (`rg` first, then focused reads).
3. Make the smallest complete change that satisfies requirements.
4. Run targeted checks for changed behavior.
5. Report: what changed, proof it works, any remaining risk.

## Token Efficiency Protocol
- Keep responses compact and decision-focused.
- Summarize findings; avoid pasting large file contents.
- Read files in slices, not full dumps, unless required.
- Prefer single best option; list alternatives only on request.
- Avoid repeating known context or restating the prompt.
- Use this response structure for non-trivial work:
  1. `Outcome`
  2. `Files Changed`
  3. `Validation`
  4. `Risks / Open Items`

## Engineering Quality Bar
- Follow existing project patterns and conventions.
- Prioritize readability and maintainability over cleverness.
- Keep functions focused and deterministic.
- Add or update tests when behavior changes.
- Validate edge cases for user input, null/undefined, and async failures.
- Preserve backward compatibility unless explicitly changing contracts.

## Speed + Safety Heuristics
- If fix is obvious and low-risk: implement immediately.
- If ambiguous and high-impact: ask one precise question, then proceed.
- If blocked by tooling or permissions: state blocker and the exact next command needed.
- If a task is large: batch into small shippable increments.

## Project Command Matrix
Use exact commands below unless task requires broader validation.

### App (`knead-and-bake-website`)
- Install deps (if needed): `npm install`
- Build: `npm run build`
- Local smoke check: `npm run dev`

### Infra (`knead-and-bake-website/infra`)
- Install deps (if needed): `npm install`
- TypeScript build: `npm run build`
- Template synthesis: `npm run synth`
- Planned infra delta review: `npm run diff`
- Deploy (only when explicitly requested): `npm run deploy`

## Verification Standard
Run the narrowest checks that prove correctness first, then broaden only if needed:
1. For app code changes: `npm run build` in `knead-and-bake-website`.
2. For infra code changes: `npm run build` then `npm run synth` in `knead-and-bake-website/infra`.
3. For infra behavior/risk review: `npm run diff` in `knead-and-bake-website/infra`.

If checks cannot run, explicitly state what was not validated.

## Deployment Readiness Checklist
- Behavior meets acceptance criteria.
- No debug code, dead code, or stray logs.
- Config/env changes are documented.
- Error paths are handled with actionable messages.
- Rollback path is clear for risky changes.
- For infra releases: include `npm run diff` summary before deploy.

## Git and Change Discipline
- Keep diffs tight and task-scoped.
- Do not mix unrelated changes.
- Use clear commit messages:
  - `feat: ...`
  - `fix: ...`
  - `refactor: ...`
  - `chore: ...`

## Communication Contract
- Simple request: short direct answer.
- Complex request: concise status plus concrete evidence.
- Always include file paths when describing edits.
- Prefer facts, commands, and results over narrative.

## Project-Specific Priority (knead-and-bake-website)
- Protect production flows first: admin actions, data paths, and deploy infra.
- For frontend edits: preserve brand consistency and mobile behavior.
- For infra edits: minimize blast radius and verify environment assumptions.
