# Backlog — Knead & Bake TX

Bugs, fixes, and improvements to resolve before starting new features.

---

## Bugs

- [ ] **Browser cache serves stale JS** — `components.js` and other JS files have 1-year cache headers. After deploys, users may see old behavior until hard-refresh. Consider adding content hashing or cache-busting version params to JS imports across all pages.
- [ ] **Old announcements missing new fields** — Announcements created before the title/excerpt/content fields were added have empty values in DynamoDB. They still display correctly (fallback to `message`), but the admin table shows "—" for title.

## Improvements

- [ ] **Centralize `window.__API_BASE`** — Currently hardcoded in 5 separate HTML files (index, admin, market, preorder, news). Should be set in one shared place to avoid missed pages.

## Resolved

_Move completed items here with date._

---

*Check this file before starting any new feature work.*
