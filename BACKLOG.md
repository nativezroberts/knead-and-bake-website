# Backlog — Knead & Bake TX

Bugs, fixes, and improvements to resolve before starting new features.

---

## Bugs

- [ ] **Browser cache serves stale JS** — `components.js` and other JS files have 1-year cache headers. After deploys, users may see old behavior until hard-refresh. Consider adding content hashing or cache-busting version params to JS imports across all pages.
- [ ] **Old announcements missing new fields** — Announcements created before the title/excerpt/content fields were added have empty values in DynamoDB. They still display correctly (fallback to `message`), but the admin table shows "—" for title.

## Improvements

### 🔴 High Priority — Security

- [x] **Upgrade password hashing to bcrypt** — Admin password currently uses HMAC-SHA256 with a hardcoded salt, which is fast and crackable via GPU brute-force. Replace with `bcryptjs` (cost=12) in `infra/lambda/auth/index.mjs` and re-store the hash in SSM. (2026-04-20)
- [ ] **Replace custom markdown renderer with markdown-it + DOMPurify** — Custom renderer in `src/js/markdown.js` is vulnerable to XSS via crafted image alt/link attributes inserted via `innerHTML` in `admin.js:262`. Replace with `markdown-it` and sanitize output with `DOMPurify`.
- [x] **Switch GitHub Actions to OIDC auth** — Created OIDC provider, scoped IAM role (`github-actions-knead-bake-deploy`), updated deploy.yml. Deleted `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from GitHub. (2026-04-11)
- [ ] **Move Venmo handle to SSM Parameter Store** — `@Allyson-Roberts1` is hardcoded in `infra/lambda/orders/index.mjs:173,202,573`. Move to SSM `/knead-bake/payment-venmo-handle`, fetch at runtime.
- [ ] **Scope S3 image uploads** — `api-stack.ts:178` grants `grantPut(adminFn, 'news-images/*')` with no path/quota enforcement. Enforce `news-images/{uuid}_{filename}` naming in Lambda, add per-day upload count to DynamoDB.

### 🟠 Moderate Priority — Security

- [x] **Restrict CORS allowed headers** — Removed `http://localhost:3000` and `http://localhost:8080` from `allowOrigins` in `api-stack.ts`. `allowHeaders` was already `['Content-Type', 'Authorization']`. (2026-03-07)
- [x] **Remove inline `onclick` from admin.html** — Replaced `onclick="window.location.reload()"` on the header refresh button with `id="header-refresh-btn"`. Event listener wired in `initAdmin()` in `admin.js`. (2026-03-07)
- [ ] **Harden Content Security Policy (remove unsafe-inline)** — CSP in `static-site-stack.ts` allows `unsafe-inline` for scripts and styles, defeating XSS protection. Extract `admin.html` inline `<style>` block to `src/css/admin.css`, add nonce-based script CSP, and remove `unsafe-inline` from both directives.
- [x] **Port orders rate limiting to DynamoDB** — Replaced in-memory `Map()` rate limiter in `orders/index.mjs` with DynamoDB-backed `isRateLimited()`. Uses `ORDER_RATE` type in CONFIG_TABLE with TTL. Persistent across cold starts and instances. Added `PutCommand` + `UpdateCommand` imports. (2026-03-07)

### 🟠 Moderate Priority — Security (new from 2026-04-10 audit)

- [ ] **Auth token in global JS variable** — `admin.js:14,195,214` stores JWT in `let authToken`. Move to `sessionStorage` with short TTL; clear on logout.
- [ ] **Inventory race condition** — Concurrent orders can oversell. Use DynamoDB `UpdateCommand` with `ConditionExpression: 'quantity >= :decrement'` in `infra/lambda/orders/index.mjs`.
- [ ] **Missing SRI hashes on Google Analytics** — All pages load `googletagmanager.com/gtag/js` without `integrity=` attribute. Generate SHA-384 hash and add to all page `<script>` tags.
- [ ] **Add `npm audit` to CI/CD** — deploy.yml has no dependency vulnerability scan. Add `npm audit --production --audit-level=moderate` step before build.
- [ ] **Hardcoded emails in source** — `allyson.m.roberts@gmail.com` appears in 15+ locations across `infra/lib/api-stack.ts`, Lambdas, `src/js/admin.js`. Centralize in SSM `/knead-bake/owner-email` and inject via Lambda env var.

### 🟡 Low Priority — Security

- [x] **Remove hardcoded email from admin.html form value** — Removed `value="allyson.m.roberts@gmail.com"` from `admin.html:511`; field now starts empty with placeholder only. Hint text updated to "default owner email". Backend fallback unchanged. (2026-03-03)
- [x] **Add request body size limits to all Lambdas** — Added 5MB body size guard (`event.body.length > 5 * 1024 * 1024 → 413`) to `orders/index.mjs`, `auth/index.mjs`, and `admin/index.mjs`. (2026-03-07)
- [ ] **Add magic byte validation to image uploads** — Not feasible in Lambda: images are uploaded directly to S3 via presigned URLs (Lambda never receives file bytes). Requires an S3 Event trigger + Lambda or Lambda@Edge to inspect file content post-upload. Architectural change needed before implementing.
- [ ] **Pin GitHub Actions to commit SHAs** — deploy.yml uses semver pins (e.g. `v6.0.2`). For supply-chain hardness, pin to full git SHAs (e.g. `actions/checkout@abc123...  # v6.0.2`).
- [ ] **Path traversal guard in build script** — `scripts/build.js` uses `recipe.slug` directly in `fs.copyFileSync` path. Add `if (!/^[a-z0-9-]+$/.test(recipe.slug)) throw` guard.
- [ ] **Add Dependabot** — No `.github/dependabot.yml`. Add weekly update config for both root and `infra/` npm workspaces.
- [ ] **CDK deploy approval flag** — deploy.yml runs `cdk deploy --require-approval never`. Change to `--require-approval broadening` so destructive infra changes require manual approval.
- [x] **Add admin audit log to DynamoDB** — Added `knead-bake-audit-log` DynamoDB table (PK: `resourceType`, SK: `auditId`, 90-day TTL). Added `writeAuditLog()` helper to `infra/lambda/admin/index.mjs`. Instrumented all 13 state-changing handlers: skip dates (2), announcements (3), news posts (3), product inventory (3), and orders (2). Audit failures are non-blocking. (2026-03-03)
- [x] **Add CloudWatch alarms and SNS alerting** — Added SNS topic `knead-bake-alarms` with email subscription in `api-stack.ts`. CloudWatch error alarms (threshold: 3 errors / 5 min) wired to all 3 Lambdas (orders, auth, admin). (2026-03-07)

### 🔵 UX / Design

- [x] **Fix admin orders table layout on mobile** — Stacked card layout with `data-label` pseudo-labels already present in `admin.html` at `@media (max-width: 860px)`. Confirmed complete — no changes needed. (2026-03-07)
- [x] **Add retry logic with exponential backoff for API calls** — `authFetch()` in `admin.js` now retries up to 3 times on 5xx responses with 100ms / 200ms exponential delay before surfacing the error to the user. Auth errors (401/403) still throw immediately. (2026-03-07)
- [x] **Add loading state to image uploads in admin panel** — Upload button (`news-post-upload-btn`, `announcement-upload-btn`) now disables and shows "Uploading…" on start; restores to "Upload Image" on success or error in both `initNewsEditor()` and `initAnnouncementEditor()`. (2026-03-07)

## Resolved

- [x] **Centralize `window.__API_BASE`** — Moved to `src/js/config.js`, referenced via `<script src="/src/js/config.js">` in all 7 pages. (2026-02-26)
- [x] **XSS hardening** — Added `escapeHtml()` to `components.js`, applied to all render functions and inline innerHTML calls across all pages. (2026-02-26)
- [x] **Grammar fixes in menu.json** — Fixed missing spaces before parentheses and inconsistent capitalization in 3 items. (2026-02-26)
- [x] **Invalid Date on news pages** — Added `formatNewsDate()` helper to `components.js`; applied safe date normalization in both `renderNewsItem` and `news-detail.html`. Handles missing, ISO, and malformed `startDate` values. (2026-03-03)

---

*Check this file before starting any new feature work.*
