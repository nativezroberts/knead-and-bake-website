# Backlog — Knead & Bake TX

Bugs, fixes, and improvements to resolve before starting new features.

---

## Bugs

- [ ] **Browser cache serves stale JS** — `components.js` and other JS files have 1-year cache headers. After deploys, users may see old behavior until hard-refresh. Consider adding content hashing or cache-busting version params to JS imports across all pages.
- [ ] **Old announcements missing new fields** — Announcements created before the title/excerpt/content fields were added have empty values in DynamoDB. They still display correctly (fallback to `message`), but the admin table shows "—" for title.

## Improvements

## Resolved

- [x] **Centralize `window.__API_BASE`** — Moved to `src/js/config.js`, referenced via `<script src="/src/js/config.js">` in all 7 pages. (2026-02-26)
- [x] **XSS hardening** — Added `escapeHtml()` to `components.js`, applied to all render functions and inline innerHTML calls across all pages. (2026-02-26)
- [x] **Grammar fixes in menu.json** — Fixed missing spaces before parentheses and inconsistent capitalization in 3 items. (2026-02-26)
- [x] **Invalid Date on news pages** — Added `formatNewsDate()` helper to `components.js`; applied safe date normalization in both `renderNewsItem` and `news-detail.html`. Handles missing, ISO, and malformed `startDate` values. (2026-03-03)

---

*Check this file before starting any new feature work.*
