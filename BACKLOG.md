# Backlog — Knead & Bake TX

Bugs, fixes, and improvements to resolve before starting new features.

---

## Bugs

- [ ] **Browser cache serves stale JS** — `components.js` and other JS files have 1-year cache headers. After deploys, users may see old behavior until hard-refresh. Consider adding content hashing or cache-busting version params to JS imports across all pages.
- [ ] **Old announcements missing new fields** — Announcements created before the title/excerpt/content fields were added have empty values in DynamoDB. They still display correctly (fallback to `message`), but the admin table shows "—" for title.

## Improvements

### 🔴 High Priority — Security

- [ ] **Upgrade password hashing to bcrypt** — Admin password currently uses HMAC-SHA256 with a hardcoded salt, which is fast and crackable via GPU brute-force. Replace with `bcryptjs` (cost=12) in `infra/lambda/auth/index.mjs` and re-store the hash in SSM.
- [ ] **Replace custom markdown renderer with markdown-it + DOMPurify** — Custom renderer in `src/js/markdown.js` is vulnerable to XSS via crafted image alt/link attributes inserted via `innerHTML` in `admin.js:262`. Replace with `markdown-it` and sanitize output with `DOMPurify`.

### 🟠 Moderate Priority — Security

- [x] **Restrict CORS allowed headers** — Removed `http://localhost:3000` and `http://localhost:8080` from `allowOrigins` in `api-stack.ts`. `allowHeaders` was already `['Content-Type', 'Authorization']`. (2026-03-07)
- [x] **Remove inline `onclick` from admin.html** — Replaced `onclick="window.location.reload()"` on the header refresh button with `id="header-refresh-btn"`. Event listener wired in `initAdmin()` in `admin.js`. (2026-03-07)
- [ ] **Harden Content Security Policy (remove unsafe-inline)** — CSP in `static-site-stack.ts` allows `unsafe-inline` for scripts and styles, defeating XSS protection. Extract `admin.html` inline `<style>` block to `src/css/admin.css`, add nonce-based script CSP, and remove `unsafe-inline` from both directives.
- [x] **Port orders rate limiting to DynamoDB** — Replaced in-memory `Map()` rate limiter in `orders/index.mjs` with DynamoDB-backed `isRateLimited()`. Uses `ORDER_RATE` type in CONFIG_TABLE with TTL. Persistent across cold starts and instances. Added `PutCommand` + `UpdateCommand` imports. (2026-03-07)

### 🟡 Low Priority — Security

- [x] **Remove hardcoded email from admin.html form value** — Removed `value="allyson.m.roberts@gmail.com"` from `admin.html:511`; field now starts empty with placeholder only. Hint text updated to "default owner email". Backend fallback unchanged. (2026-03-03)
- [x] **Add request body size limits to all Lambdas** — Added 5MB body size guard (`event.body.length > 5 * 1024 * 1024 → 413`) to `orders/index.mjs`, `auth/index.mjs`, and `admin/index.mjs`. (2026-03-07)
- [ ] **Add magic byte validation to image uploads** — Not feasible in Lambda: images are uploaded directly to S3 via presigned URLs (Lambda never receives file bytes). Requires an S3 Event trigger + Lambda or Lambda@Edge to inspect file content post-upload. Architectural change needed before implementing.
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
