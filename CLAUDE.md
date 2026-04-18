# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Local smoke check: `npm run dev` → http://localhost:3000

> No test runner or linter is configured. Validation is manual + build success.

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

---

## Architecture Overview

**Stack**: Vanilla HTML/CSS/JS (no framework) + AWS serverless backend. Zero frontend build step — `scripts/build.js` copies source files to `/dist`.

### Frontend Data Flow

All content is stored in `content/*.json` and fetched at runtime by the browser:

```
content/*.json  →  src/js/content-loader.js (singleton cache)
                       ↓
                   src/js/components.js (pure render functions)
                       ↓
                   page scripts (index, menu, recipes, etc.)
```

- `content-loader.js` — fetches and caches JSON; all pages go through this singleton
- `components.js` — stateless render functions returning HTML strings (cards, accordions, news items)
- `product-model.js` — single source of truth for product availability; status enum: `available`, `sold_out`, `not_available`
- Dynamic pages (`recipe-detail.html`, `news-detail.html`) load content via URL query params (e.g., `?slug=sourdough`, `?id=123`)

### CSS Layer Order

`src/css/main.css` imports in dependency order:
1. `variables.css` — design tokens (`--bg-primary`, `--text-link`, spacing, fonts)
2. `reset.css` — CSS reset + accessibility utilities
3. `layout.css` — header, footer, hero, page shells
4. `components.css` — buttons, cards, forms, accordions
5. `pages.css` — page-specific overrides

Always place new styles in the correct layer. Never add design tokens inline — add to `variables.css`.

### Content Editing Conventions

- **Menu items**: `content/menu.json` → `items[]`. SKU format: `CATEGORY-PREFIX-NNN` (e.g., `SL-004`).
- **Market dates / preorder cutoff**: `content/site-config.json` → `nextMarket`.
- **News posts**: managed via `/admin.html` dashboard (stored in DynamoDB, not JSON files).
- **Recipes**: `content/recipes.json` → `recipes[]`. Build auto-generates detail pages per slug.

### Order / Payment Flow

`src/js/order-form.js` → Square Web Payments SDK → POST `/api/orders` → Lambda

The Lambda (`infra/lambda/orders/index.mjs`) is the authoritative validator:
- Bundles `infra/lambda/orders/menu.json` for server-side price validation (prevents client-side tampering)
- Deducts inventory atomically via DynamoDB conditional writes
- Rate limits: 5 requests / 60 seconds per IP (fails open — never blocks legitimate orders)
- Sends SES emails: owner always; customer only when `sesSandbox: false` in `infra/bin/app.ts`

**If menu prices or items change**, update both `content/menu.json` (frontend) and `infra/lambda/orders/menu.json` (backend validation) — they must stay in sync.

### Infra Architecture

Two CDK stacks in `infra/lib/`:

| Stack | Key Resources |
|-------|--------------|
| `StaticSiteStack` | S3 (private, OAC) + CloudFront + CloudFront Function (URL rewriting) |
| `ApiStack` | API Gateway v2 + Lambda (Node.js 22) + DynamoDB (3 tables) + SES |

**URL rewriting**: CloudFront Function rewrites clean URLs → `.html` (e.g., `/about` → `/about.html`). This lives in `infra/lib/static-site-stack.ts`, not in the app.

**Caching**: HTML/JSON = 5 min; CSS/JS/images = 1 year immutable. CI auto-invalidates `/*` on deploy.

**DynamoDB tables**: `knead-bake-orders`, `knead-bake-market-config`, `knead-bake-audit-log`. All have point-in-time recovery. S3 bucket uses `RemovalPolicy.RETAIN`.

**SES sandbox toggle**: `sesSandbox` boolean in `infra/bin/app.ts`. Set `true` to suppress customer confirmation emails (owner emails always send).

### CI/CD

`.github/workflows/deploy.yml` — on push to `main`:
1. Builds site (`node scripts/build.js`)
2. Syncs `/dist` to S3
3. Invalidates CloudFront `/*`

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`.
