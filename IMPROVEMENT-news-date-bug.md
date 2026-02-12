# Improvement: Fix Invalid Date on News Pages

Date: 2026-02-12
Scope: `news.html`, `news-detail.html`, `src/js/components.js`

## Problem Summary
The News list/detail sometimes displays `Invalid Date` even when posts are valid and `endDate` is intentionally blank.

## Root Cause
The frontend assumes `startDate` is always a strict `YYYY-MM-DD` string and always parseable.

Current code paths:
- `src/js/components.js:47-49`
- `src/pages/news-detail.html:119-121`

Both use:
- `new Date(startDate + 'T00:00:00')`

This fails when `startDate` is:
- missing/empty
- already an ISO datetime string (example: `2026-02-10T00:00:00.000Z`)
- any non-`YYYY-MM-DD` value

`endDate` being optional is not the bug.

## Repro Conditions
Any item from `/api/news` with malformed or non-normalized `startDate` causes:
- `toLocaleDateString(...)` => `Invalid Date`

## Required Fix (Next Update)
1. Normalize incoming date value before parse.
2. Validate parse result before rendering.
3. Render safe fallback text if invalid.
4. Apply same logic in both list and detail pages.

## Suggested Implementation
Use a shared helper (preferred) or duplicate minimal logic:

```js
function formatNewsDate(value) {
  const raw = String(value || '').slice(0, 10); // normalize ISO/date-like to YYYY-MM-DD
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { display: 'Date unavailable', datetime: '' };
  }
  return {
    display: parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    datetime: raw,
  };
}
```

Use in:
- `renderNewsItem(...)` in `src/js/components.js`
- post header date logic in `src/pages/news-detail.html`

## Acceptance Criteria
- No `Invalid Date` text appears in news list/detail.
- Posts with blank `endDate` still render normally.
- Valid `YYYY-MM-DD` start dates format as expected.
- ISO datetime `startDate` values still display correctly.
- Missing/invalid `startDate` displays `Date unavailable`.

## Notes
Backend create validation already requires valid `startDate`:
- `infra/lambda/admin/index.mjs:314`

Likely data-source cause is legacy/manual records or mixed date formats in DynamoDB.
