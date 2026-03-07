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

- [ ] **Restrict CORS allowed headers** — `api-stack.ts` sets `allowHeaders: ['*']` and includes localhost origins in production. Restrict to `['Content-Type', 'Authorization']` and remove `localhost` entries from the allowed origins list.
- [x] **Remove inline `onclick` from admin.html** — Replaced `onclick="window.location.reload()"` on the header refresh button with `id="header-refresh-btn"`. Event listener wired in `initAdmin()` in `admin.js`. (2026-03-07)
- [ ] **Harden Content Security Policy (remove unsafe-inline)** — CSP in `static-site-stack.ts` allows `unsafe-inline` for scripts and styles, defeating XSS protection. Extract `admin.html` inline `<style>` block to `src/css/admin.css`, add nonce-based script CSP, and remove `unsafe-inline` from both directives.
- [ ] **Port orders rate limiting to DynamoDB** — `infra/lambda/orders/index.mjs` uses an in-memory `Map()` for rate limiting that resets on cold start and is bypassed across Lambda instances. Migrate to DynamoDB with TTL, matching the pattern used in `auth/index.mjs`.

### 🟡 Low Priority — Security

- [x] **Remove hardcoded email from admin.html form value** — Removed `value="allyson.m.roberts@gmail.com"` from `admin.html:511`; field now starts empty with placeholder only. Hint text updated to "default owner email". Backend fallback unchanged. (2026-03-03)
- [ ] **Add request body size limits to all Lambdas** — No Lambda validates the size of `event.body`. Add a guard rejecting payloads over 5MB at the top of each Lambda handler to prevent cost abuse and DoS.
- [ ] **Add magic byte validation to image uploads** — Image uploads in `infra/lambda/admin/index.mjs` check MIME type only, which can be spoofed. Read the first 4 bytes of the upload buffer and validate against known file signatures (JPEG: `FF D8 FF`, PNG: `89 50 4E 47`).
- [x] **Add admin audit log to DynamoDB** — Added `knead-bake-audit-log` DynamoDB table (PK: `resourceType`, SK: `auditId`, 90-day TTL). Added `writeAuditLog()` helper to `infra/lambda/admin/index.mjs`. Instrumented all 13 state-changing handlers: skip dates (2), announcements (3), news posts (3), product inventory (3), and orders (2). Audit failures are non-blocking. (2026-03-03)
- [ ] **Add CloudWatch alarms and SNS alerting** — Lambda errors are silent unless manually checked. Add CDK CloudWatch Alarms on `metricErrors()` for all Lambdas connected to an SNS topic that sends email notifications.

### 🔵 UX / Design

- [ ] **Fix admin orders table layout on mobile** — Orders table uses fixed-width columns that overflow horizontally on small screens. Refactor to stacked card layout using `data-label` attributes and responsive CSS at ≤600px.
- [ ] **Add retry logic with exponential backoff for API calls** — API failures in `admin.js` surface immediately with no retry. Add up to 3 retries with 2ˣ × 100ms delay for 5xx responses before showing an error to the user.
- [ ] **Add loading state to image uploads in admin panel** — Image uploads show no visual feedback during upload. Disable the upload button and show a spinner on start; re-enable with success or error message on completion.

## Resolved

- [x] **Centralize `window.__API_BASE`** — Moved to `src/js/config.js`, referenced via `<script src="/src/js/config.js">` in all 7 pages. (2026-02-26)
- [x] **XSS hardening** — Added `escapeHtml()` to `components.js`, applied to all render functions and inline innerHTML calls across all pages. (2026-02-26)
- [x] **Grammar fixes in menu.json** — Fixed missing spaces before parentheses and inconsistent capitalization in 3 items. (2026-02-26)
- [x] **Invalid Date on news pages** — Added `formatNewsDate()` helper to `components.js`; applied safe date normalization in both `renderNewsItem` and `news-detail.html`. Handles missing, ISO, and malformed `startDate` values. (2026-03-03)

---

*Check this file before starting any new feature work.*
