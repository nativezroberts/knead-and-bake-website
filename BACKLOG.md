# Backlog — Knead & Bake TX

All open bugs, security fixes, and improvements. Check this file before starting any new feature work. Each item is self-contained and branch-ready.

---

## Status Summary

| # | Item | Priority | Effort | Status |
|---|---|---|---|---|
| S1 | Create / complete Google Business Profile | 🔴 SEO Priority | S | 🔲 Open |
| S2 | Get 20+ Google reviews (QR card + IG ask) | 🔴 SEO Priority | Ongoing | 🔲 Open |
| S3 | Add LocalBusiness JSON-LD to homepage | 🟠 SEO | XS | ✅ Done 2026-04-25 |
| S4 | Fix robots.txt + sitemap (admin disallow, clean URLs) | 🟠 SEO | XS | ✅ Done 2026-04-25 |
| S5 | Fix meta/OG/Twitter tags across all pages | 🟠 SEO | XS | ✅ Done 2026-04-25 |
| S6 | Add Recipe JSON-LD to recipe detail pages | 🟠 SEO | XS | ✅ Done 2026-04-25 |
| S7 | Submit to Yelp, Bing Places, Apple Maps | 🟠 SEO | S | 🔲 Open |
| S8 | Set up Google Search Console + submit sitemap | 🟠 SEO | XS | 🔲 Open |
| S9 | Publish keyword-targeted news posts (weekly) | 🟡 SEO | Ongoing | 🔲 Open |
| S10 | Verify homepage H1 contains "sourdough New Braunfels" | 🟡 SEO | XS | 🔲 Open |
| S11 | Add Nextdoor business listing | 🟡 SEO | XS | 🔲 Open |
| S12 | Print QR-code review card for market booth | 🟡 SEO | XS | 🔲 Open |
| 1 | Switch GitHub Actions to OIDC auth | 🔴 High Security | L | ✅ Done 2026-04-11 |
| 2 | Upgrade password hashing to bcrypt | 🔴 High Security | S | ✅ Done 2026-04-20 |
| 3 | Replace markdown renderer with markdown-it + DOMPurify | 🔴 High Security | S | ✅ Done 2026-05-13 |
| 4 | Move Venmo handle to SSM | 🔴 High Security | S | 🔲 Open |
| 5 | Scope S3 image uploads | 🔴 High Security | M | 🔲 Open |
| 6 | Harden Content Security Policy | 🟠 Moderate Security | M | 🔲 Open |
| 7 | Move auth token to sessionStorage | 🟠 Moderate Security | S | 🔲 Open |
| 8 | Fix inventory race condition | 🟠 Moderate Security | S | ✅ Done (already implemented via TransactWriteCommand) |
| 9 | Add npm audit to CI/CD | 🟠 Moderate Security | XS | 🔲 Open |
| 10 | Move hardcoded emails to SSM | 🟠 Moderate Security | M | 🔲 Open |
| 11 | SRI hashes on Google Analytics | 🟠 Moderate Security | S | ❌ Dropped — GTM rotates scripts, SRI would break on every GA update |
| 12 | Fix browser cache stale JS | 🐛 Bug | M | 🔲 Open |
| 13 | Backfill old announcements | 🐛 Bug | S | ⚠️ Needs DynamoDB verify first |
| 14 | Magic byte validation for image uploads | 🟡 Low Security | L | ⏸ Deferred — architectural change, low ROI now |
| 15 | Pin GitHub Actions to commit SHAs | 🟡 Low Security | S | 🔲 Open |
| 16 | Path traversal guard in build script | 🟡 Low Security | XS | 🔲 Open |
| 17 | Add Dependabot | 🟡 Low Security | XS | 🔲 Open |
| 18 | CDK deploy approval flag | 🟡 Low Security | XS | 🔲 Open |

**Effort key:** XS = <30 min · S = 30–90 min · M = 2–4 hrs · L = 4+ hrs

---

## Open Items

---

### S1. Create / complete Google Business Profile
**Owner:** Allyson / Zach
**URL:** https://business.google.com

1. Sign in with Google account and search for "Knead & Bake TX" to claim or create
2. Category: **Bakery** (primary), Farmers Market (secondary)
3. Service area: New Braunfels TX + Seguin, San Marcos, Canyon Lake
4. Hours: Saturday 8:00 AM – 1:00 PM (market hours)
5. Website: `https://kneadandbaketx.com`
6. Description: *"Handcrafted small-batch sourdough bread baked in New Braunfels, TX. Find us every Saturday at the Castell Street Farmers Market. Preorder online for guaranteed pickup."*
7. Upload 10+ photos: loaves, booth, Allyson baking, product close-ups
8. Enable Google Posts (reuse weekly news posts)

---

### S2. Get 20+ Google reviews
**Owner:** Allyson

1. Get your short review link from GBP dashboard → "Get more reviews"
2. Post to Instagram stories after every market with the review link
3. Print a small card with QR code to hand out at booth (see S12)
4. DM/text repeat customers asking for a review
5. Target: 20 reviews to break into the Map Pack for "sourdough New Braunfels"

---

### S7. Submit to Yelp, Bing Places, Apple Maps
**Owner:** Zach / Allyson

1. **Yelp:** `biz.yelp.com` → Add Business → Bakery in New Braunfels TX
2. **Bing Places:** `bingplaces.com` → Import from Google Business or create new
3. **Apple Maps:** `mapsconnect.apple.com` → Add a New Place
4. **New Braunfels Chamber:** search for member directory listing
5. **Critical:** NAP must be identical everywhere — `Knead & Bake TX`, same address format, same phone

---

### S8. Set up Google Search Console
**Owner:** Zach

1. Go to `search.google.com/search-console`
2. Add property: `https://kneadandbaketx.com`
3. Verify ownership via HTML tag or Google Analytics (GA already on site — easiest method)
4. Submit sitemap: `https://kneadandbaketx.com/sitemap.xml`
5. Monitor Search Console weekly for crawl errors and keyword impressions

---

### S9. Publish keyword-targeted news posts (weekly)
**Owner:** Allyson / Claude (via `/publish-bakery-news`)

Target keyword themes for posts:
- "sourdough New Braunfels" — "Where to find fresh sourdough in New Braunfels every Saturday"
- "Castell Street Market bread" — "What we bring to Castell Street Market this week"
- "preorder sourdough New Braunfels" — "How to preorder your loaf for Saturday pickup"
- "sourdough starter tips Texas" — "Starter tips from a New Braunfels baker"
- "artisan bread New Braunfels" — "Why small-batch matters: our baking philosophy"

---

### S10. Verify homepage H1 contains "sourdough New Braunfels"
**Branch:** `seo/homepage-h1`
**Owner:** Zach / Allyson

1. Check the hero `<h1>` text on `index.html` — should read something like *"Artisan Sourdough Bread in New Braunfels, TX"*
2. If not, update the H1 to naturally include the phrase
3. Do NOT change the visual style — font, size, color stay the same

---

### S12. Print QR-code review card for market booth
**Owner:** Zach

1. Get short Google review URL from GBP dashboard
2. Generate a QR code at qr-code-generator.com
3. Print small cards: "Loved your bread? Leave us a Google review!" + QR code
4. Hand out at the booth each Saturday

---

### 3. Replace markdown renderer with markdown-it + DOMPurify
**Branch:** `security/markdown-it-dompurify`
**Files:** `src/js/markdown.js`, `src/js/admin.js`, `src/pages/admin.html`

1. Add to `package.json` devDependencies: `markdown-it`, `dompurify`
2. Rewrite `src/js/markdown.js`:
   ```javascript
   import MarkdownIt from 'markdown-it';
   import DOMPurify from 'dompurify';
   const md = new MarkdownIt({ html: false, linkify: true });
   export function renderMarkdown(input) {
     return DOMPurify.sanitize(md.render(input));
   }
   ```
3. In `admin.js:262` (and all other `innerHTML` calls with markdown), replace raw renderer with `renderMarkdown()`
4. Remove old `src/js/markdown.js` implementation
5. Rebuild and test all markdown preview flows in admin panel

---

### 4. Move Venmo handle to SSM
**Branch:** `security/ssm-venmo-handle`
**Files:** `infra/lambda/orders/index.mjs`, `infra/lib/api-stack.ts`

1. Add SSM parameter: `aws ssm put-parameter --name /knead-bake/payment-venmo-handle --value "@Allyson-Roberts1" --type SecureString`
2. In `api-stack.ts`, add SSM read permission to orders Lambda and pass as env var:
   ```typescript
   const venmoParam = ssm.StringParameter.fromSecureStringParameterAttributes(...);
   venmoParam.grantRead(ordersFn);
   ordersFn.addEnvironment('VENMO_HANDLE', venmoParam.stringValue);
   ```
3. In `orders/index.mjs:173,202,573` replace hardcoded `@Allyson-Roberts1` with `process.env.VENMO_HANDLE`
4. Deploy and verify Venmo link still appears in order confirmation emails

---

### 5. Scope S3 image uploads
**Branch:** `security/scope-image-uploads`
**Files:** `infra/lambda/admin/index.mjs`, `infra/lib/api-stack.ts`

1. In the presigned URL Lambda handler, enforce path format:
   ```javascript
   const uuid = crypto.randomUUID();
   const safeName = filename.replace(/[^a-z0-9.\-_]/gi, '_').slice(0, 100);
   const key = `news-images/${uuid}_${safeName}`;
   ```
2. Add daily upload quota check via DynamoDB (count uploads per adminId per UTC day, reject if > 50)
3. Log each upload to audit table (`writeAuditLog('image-upload', { key, adminId })`)
4. In `api-stack.ts`, ensure `grantPut` scope stays as `news-images/*` (already scoped — just enforce naming in Lambda)

---

### 6. Harden Content Security Policy (remove unsafe-inline)
**Branch:** `security/harden-csp`
**Files:** `infra/lib/static-site-stack.ts`, `src/pages/admin.html`, `src/css/admin.css`

1. Extract the inline `<style>` block from `admin.html` into `src/css/admin.css`
2. Add `<link rel="stylesheet" href="/src/css/admin.css">` to `admin.html`
3. For scripts, generate a nonce at CloudFront level (Lambda@Edge) OR move all inline `<script>` blocks to external `.js` files
4. In `static-site-stack.ts`, update CSP:
   - Remove `'unsafe-inline'` from `script-src`
   - Remove `'unsafe-inline'` from `style-src`
5. Load test all pages — watch browser console for CSP violations
6. Fix any remaining violations (check Network tab for blocked resources)

---

### 7. Move auth token to sessionStorage
**Branch:** `security/auth-token-storage`
**Files:** `src/js/admin.js`

1. Replace `let authToken = null` with sessionStorage reads/writes:
   ```javascript
   // Store: sessionStorage.setItem('authToken', data.token);
   // Read:  const token = sessionStorage.getItem('authToken');
   // Clear: sessionStorage.removeItem('authToken');
   ```
2. Update all `authToken` references across `admin.js` to use `sessionStorage.getItem('authToken')`
3. In logout handler, call `sessionStorage.removeItem('authToken')`
4. Test: token should be gone after tab close; logout should clear it immediately

---

### 8. Fix inventory race condition
**Branch:** `fix/inventory-race-condition`
**Files:** `infra/lambda/orders/index.mjs`

1. Wrap inventory decrement in a DynamoDB conditional write:
   ```javascript
   await ddb.send(new UpdateCommand({
     TableName: INVENTORY_TABLE,
     Key: { sku: item.sku },
     UpdateExpression: 'SET quantity = quantity - :qty',
     ConditionExpression: 'quantity >= :qty',
     ExpressionAttributeValues: { ':qty': item.quantity }
   }));
   ```
2. Catch `ConditionalCheckFailedException` → return 409 with message "Item sold out"
3. Test with concurrent requests using `Promise.all` in a local test script

---

### 9. Add npm audit to CI/CD
**Branch:** `chore/npm-audit-ci`
**Files:** `.github/workflows/deploy.yml`

1. After `npm ci` in the build job, add:
   ```yaml
   - name: Audit dependencies
     run: npm audit --production --audit-level=moderate
   ```
2. Also add in `deploy-infra` job after CDK `npm ci`:
   ```yaml
   - name: Audit infra dependencies
     working-directory: infra
     run: npm audit --production --audit-level=moderate
   ```
3. If audit fails on known acceptable issues, add `--ignore-scripts` or create `.npmrc` with `audit-level=high`

---

### 10. Move hardcoded emails to SSM
**Branch:** `security/ssm-owner-email`
**Files:** `infra/lib/api-stack.ts`, `infra/lambda/orders/index.mjs`, `infra/lambda/auth/index.mjs`, `infra/lambda/admin/index.mjs`, `src/js/admin.js`

1. Add SSM parameter: `aws ssm put-parameter --name /knead-bake/owner-email --value "allyson.m.roberts@gmail.com" --type SecureString`
2. In `api-stack.ts`, fetch and inject as env var into all 3 Lambdas
3. In each Lambda, replace hardcoded email with `process.env.OWNER_EMAIL`
4. In `src/js/admin.js:12`, the email reference is frontend-only — serve from a `/config` API endpoint or leave as-is
5. Verify: `grep -r "allyson.m.roberts" src/ infra/lambda/` should return zero results

---

### 12. Fix browser cache stale JS
**Branch:** `fix/js-cache-busting`
**Files:** `scripts/build.js`, all `src/pages/*.html`

1. In `build.js`, generate a content hash for each JS file during build:
   ```javascript
   import { createHash } from 'crypto';
   const hash = createHash('md5').update(fs.readFileSync(filePath)).digest('hex').slice(0, 8);
   ```
2. Output hashed filenames: `components.abc12345.js`
3. Update HTML `<script src>` references in build output to use hashed filenames
4. OR simpler: append `?v=BUILD_HASH` query param to script URLs (no filename change needed)
5. Confirm S3 deploy still serves correct files; confirm CloudFront caches new hashed versions

---

### 13. Backfill old announcements with empty fields
**Branch:** `fix/announcement-backfill`
**Files:** one-shot script (not committed to codebase)

> ⚠️ **Verify first:** Check DynamoDB announcements table for items missing `title` field. If none exist, skip this item entirely.

1. Write a local Node script to scan the announcements DynamoDB table for items missing `title`/`excerpt`/`content` fields
2. For each missing-fields item, set `title = ''`, `excerpt = ''`, `content = item.message ?? ''`
3. Run with `--dry-run` first to preview affected items
4. Apply with `--apply` flag
5. Verify admin table no longer shows "—" for those rows
6. Delete the script after use (one-shot)

---

### 15. Pin GitHub Actions to commit SHAs
**Branch:** `chore/pin-actions-sha`
**Files:** `.github/workflows/deploy.yml`

1. For each action, get the SHA for the pinned version:
   ```bash
   gh api repos/actions/checkout/git/refs/tags/v6.0.2 --jq '.object.sha'
   ```
2. Replace semver with SHA + comment:
   ```yaml
   - uses: actions/checkout@SHA_HERE  # v6.0.2
   ```
3. Update manually when bumping action versions

---

### 16. Path traversal guard in build script
**Branch:** `fix/build-script-slug-guard`
**Files:** `scripts/build.js`

1. Find the recipe slug loop in `build.js`
2. Add before `fs.copyFileSync`:
   ```javascript
   if (!/^[a-z0-9-]+$/.test(recipe.slug)) {
     throw new Error(`Invalid recipe slug: "${recipe.slug}" — only lowercase letters, numbers, hyphens allowed`);
   }
   ```
3. Run `npm run build` to verify existing slugs pass

---

### 17. Add Dependabot
**Branch:** `chore/add-dependabot`
**Files:** `.github/dependabot.yml` (new file)

1. Create `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
       open-pull-requests-limit: 5
     - package-ecosystem: "npm"
       directory: "/infra"
       schedule:
         interval: "weekly"
       open-pull-requests-limit: 5
   ```
2. Push to main — no PR needed, low risk

---

### 18. CDK deploy approval flag
**Branch:** `chore/cdk-require-approval`
**Files:** `.github/workflows/deploy.yml`

1. Change the CDK deploy command:
   ```yaml
   # Before:
   run: npx cdk deploy --all --require-approval never
   # After:
   run: npx cdk deploy --all --require-approval broadening
   ```
2. Note: `broadening` only blocks changes that expand permissions or security groups — non-destructive infra changes still auto-approve

---

## Completed

| # | Item | Completed |
|---|---|---|
| 1 | Switch GitHub Actions to OIDC auth | 2026-04-11 |
| 2 | Upgrade password hashing to bcrypt | 2026-04-20 |
| 3 | Replace markdown renderer with markdown-it + DOMPurify | 2026-05-13 |
| 8 | Fix inventory race condition | Already done — TransactWriteCommand with ConditionExpression |
| 11 | SRI hashes on Google Analytics | ❌ Dropped — GTM scripts rotate, SRI breaks on every GA update |
| 14 | Magic byte validation for image uploads | ⏸ Deferred — requires architectural change (S3 event trigger + new Lambda) |
| — | Restrict CORS allowed headers | 2026-03-07 |
| — | Remove inline onclick from admin.html | 2026-03-07 |
| — | Port orders rate limiting to DynamoDB | 2026-03-07 |
| — | Remove hardcoded email from admin.html form | 2026-03-03 |
| — | Add request body size limits to all Lambdas | 2026-03-07 |
| — | Add admin audit log to DynamoDB | 2026-03-03 |
| — | Add CloudWatch alarms and SNS alerting | 2026-03-07 |
| — | Fix admin orders table layout on mobile | 2026-03-07 |
| — | Add retry logic with exponential backoff | 2026-03-07 |
| — | Add loading state to image uploads | 2026-03-07 |
| — | Centralize window.__API_BASE | 2026-02-26 |
| — | XSS hardening (escapeHtml) | 2026-02-26 |
| — | Grammar fixes in menu.json | 2026-02-26 |
| — | Invalid Date on news pages | 2026-03-03 |
