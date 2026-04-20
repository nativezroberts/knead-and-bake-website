# Execution Plan — Knead & Bake TX Open Items

Generated: 2026-04-10. Covers all open BACKLOG.md items + 2026-04-10 security audit findings.
Tackle in priority order. Each item is self-contained and branch-ready.

---

## WAVE 1 — High Priority Security (do first, highest risk)

### 1. Switch GitHub Actions to OIDC auth
**Branch:** `chore/oidc-aws-auth`
**Files:** `.github/workflows/deploy.yml`, AWS IAM (console)
**Steps:**
1. In AWS Console → IAM → Identity Providers → Add provider → OpenID Connect
   - URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. Create IAM role `github-actions-knead-bake-deploy` with trust policy:
   ```json
   {
     "Principal": { "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
     "Condition": { "StringLike": { "token.actions.githubusercontent.com:sub": "repo:nativezroberts/knead-and-bake-website:*" } }
   }
   ```
3. Attach scoped policy: S3 (specific bucket), CloudFront invalidation, CloudFormation (CDK needs)
4. In deploy.yml replace:
   ```yaml
   aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
   aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
   ```
   with:
   ```yaml
   role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
   ```
5. Add `AWS_DEPLOY_ROLE_ARN` to GitHub Secrets
6. Delete `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from GitHub Secrets
7. Delete the IAM access keys from AWS Console

---

### 2. Upgrade password hashing to bcrypt
**Branch:** `security/bcrypt-password`
**Files:** `infra/lambda/auth/index.mjs`, AWS SSM
**Steps:**
1. `cd infra && npm install bcryptjs`
2. In `auth/index.mjs`, replace HMAC-SHA256 hash logic with:
   ```javascript
   import bcrypt from 'bcryptjs';
   // On verify: bcrypt.compareSync(password, storedHash)
   // To generate new hash: bcrypt.hashSync(password, 12)
   ```
3. Generate new hash locally: `node -e "const b=require('bcryptjs'); console.log(b.hashSync('YOUR_PASSWORD', 12))"`
4. Update SSM parameter `/knead-bake/admin-password-hash` with the new bcrypt hash
5. Remove HMAC-SHA256 import and salt constant from auth Lambda
6. Test login flow end-to-end in staging before deploying

---

### 3. Replace markdown renderer with markdown-it + DOMPurify
**Branch:** `security/markdown-it-dompurify`
**Files:** `src/js/markdown.js`, `src/js/admin.js`, `src/pages/admin.html`
**Steps:**
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
4. Remove `src/js/markdown.js` old implementation
5. Rebuild and test all markdown preview flows in admin panel

---

### 4. Move Venmo handle to SSM
**Branch:** `security/ssm-venmo-handle`
**Files:** `infra/lambda/orders/index.mjs`, `infra/lib/api-stack.ts`
**Steps:**
1. Add SSM parameter: `aws ssm put-parameter --name /knead-bake/payment-venmo-handle --value "@Allyson-Roberts1" --type SecureString`
2. In `api-stack.ts`, add SSM read permission to orders Lambda and pass as env var:
   ```typescript
   const venmoParam = ssm.StringParameter.fromSecureStringParameterAttributes(...);
   venmoParam.grantRead(ordersFn);
   ordersFn.addEnvironment('VENMO_HANDLE', venmoParam.stringValue); // or fetch at runtime
   ```
3. In `orders/index.mjs:173,202,573` replace hardcoded `@Allyson-Roberts1` with `process.env.VENMO_HANDLE`
4. Deploy and verify Venmo link still appears correctly in order confirmation emails

---

### 5. Scope S3 image uploads
**Branch:** `security/scope-image-uploads`
**Files:** `infra/lambda/admin/index.mjs`, `infra/lib/api-stack.ts`
**Steps:**
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

## WAVE 2 — Moderate Priority Security

### 6. Harden Content Security Policy (remove unsafe-inline)
**Branch:** `security/harden-csp`
**Files:** `infra/lib/static-site-stack.ts`, `src/pages/admin.html`, `src/css/admin.css`
**Steps:**
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
**Steps:**
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
**Steps:**
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
**Steps:**
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
**Steps:**
1. Add SSM parameter: `aws ssm put-parameter --name /knead-bake/owner-email --value "allyson.m.roberts@gmail.com" --type SecureString`
2. In `api-stack.ts`, fetch and inject as env var into all 3 Lambdas
3. In each Lambda, replace hardcoded email with `process.env.OWNER_EMAIL`
4. In `src/js/admin.js:12`, the email reference is frontend-only — this can stay or be served from a `/config` API endpoint
5. Grep verify: `grep -r "allyson.m.roberts" src/ infra/lambda/` should return zero results after

---

### 11. Add SRI hashes to external scripts
**Branch:** `security/sri-hashes`
**Files:** All `src/pages/*.html`
**Steps:**
1. Generate hash: `curl -s "https://www.googletagmanager.com/gtag/js?id=G-1N89X23FB3" | openssl dgst -sha384 -binary | openssl base64 -A`
2. Add to all GA script tags:
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-1N89X23FB3"
           integrity="sha384-HASH_HERE" crossorigin="anonymous"></script>
   ```
3. Note: GTM scripts change frequently — document that SRI hashes need refreshing when GA updates

---

## WAVE 3 — Bugs

### 12. Fix browser cache stale JS
**Branch:** `fix/js-cache-busting`
**Files:** `scripts/build.js`, all `src/pages/*.html`
**Steps:**
1. In `build.js`, generate a content hash for each JS file during build:
   ```javascript
   import { createHash } from 'crypto';
   const hash = createHash('md5').update(fs.readFileSync(filePath)).digest('hex').slice(0, 8);
   ```
2. Output hashed filenames: `components.abc12345.js`
3. Update HTML `<script src>` references in build output to use hashed filenames
4. OR simpler: append `?v=BUILD_HASH` query param to script URLs in HTML (no filename change needed)
5. Confirm S3 deploy still serves correct files; confirm CloudFront caches new hashed versions

---

### 13. Backfill old announcements with empty fields
**Branch:** `fix/announcement-backfill`
**Files:** one-shot script (not committed to codebase)
**Steps:**
1. Write a local Node script to scan the announcements DynamoDB table for items missing `title`/`excerpt`/`content` fields
2. For each missing-fields item, set `title = ''`, `excerpt = ''`, `content = item.message ?? ''`
3. Run with `--dry-run` first to preview affected items
4. Apply with `--apply` flag
5. Verify admin table no longer shows "—" for those rows
6. Delete the script after use (one-shot, no need to keep)

---

## WAVE 4 — Low Priority / Infrastructure Hygiene

### 14. Add magic byte validation for image uploads
**Branch:** `feat/image-magic-byte-validation`
**Files:** `infra/lib/api-stack.ts`, new Lambda `infra/lambda/image-validator/index.mjs`
**Steps:**
1. Create S3 Event notification on `siteBucket` for `s3:ObjectCreated:*` under prefix `news-images/`
2. New Lambda reads first 12 bytes of uploaded object, checks magic bytes:
   - JPEG: `FF D8 FF`
   - PNG: `89 50 4E 47`
   - WebP: `52 49 46 46 ... 57 45 42 50`
3. If mismatch → delete the object and write to audit log
4. Wire Lambda trigger in CDK
5. Test with renamed `.txt` file with `.jpg` extension

---

### 15. Pin GitHub Actions to commit SHAs
**Branch:** `chore/pin-actions-sha`
**Files:** `.github/workflows/deploy.yml`
**Steps:**
1. For each action, get the SHA for the pinned version:
   ```bash
   gh api repos/actions/checkout/git/refs/tags/v6.0.2 --jq '.object.sha'
   ```
2. Replace semver with SHA + comment:
   ```yaml
   - uses: actions/checkout@SHA_HERE  # v6.0.2
   ```
3. Update the comment block at top of deploy.yml to include SHAs
4. Update manually when bumping action versions

---

### 16. Path traversal guard in build script
**Branch:** `fix/build-script-slug-guard`
**Files:** `scripts/build.js`
**Steps:**
1. Find the recipe slug loop in `build.js`
2. Add before `fs.copyFileSync`:
   ```javascript
   if (!/^[a-z0-9-]+$/.test(recipe.slug)) {
     throw new Error(`Invalid recipe slug: "${recipe.slug}" — only lowercase letters, numbers, hyphens allowed`);
   }
   ```
3. Run `npm run build` to verify existing slugs pass, build still succeeds

---

### 17. Add Dependabot
**Branch:** `chore/add-dependabot`
**Files:** `.github/dependabot.yml` (new file)
**Steps:**
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
**Steps:**
1. Change line 184:
   ```yaml
   # Before:
   run: npx cdk deploy --all --require-approval never
   # After:
   run: npx cdk deploy --all --require-approval broadening
   ```
2. Note: `broadening` only blocks changes that expand permissions or security groups — non-destructive infra changes still auto-approve

---

## Summary Table

| # | Item | Wave | Branch Name | Effort |
|---|---|---|---|---|
| 1 | ~~OIDC auth~~ ✅ 2026-04-11 | 1 | `chore/oidc-aws-auth` | L (IAM setup) |
| 2 | bcrypt passwords | 1 | `security/bcrypt-password` | S |
| 3 | markdown-it + DOMPurify | 1 | `security/markdown-it-dompurify` | S |
| 4 | Venmo handle → SSM | 1 | `security/ssm-venmo-handle` | S |
| 5 | Scope image uploads | 1 | `security/scope-image-uploads` | M |
| 6 | Harden CSP | 2 | `security/harden-csp` | M |
| 7 | Auth token → sessionStorage | 2 | `security/auth-token-storage` | S |
| 8 | Inventory race condition | 2 | `fix/inventory-race-condition` | S |
| 9 | npm audit in CI | 2 | `chore/npm-audit-ci` | XS |
| 10 | Emails → SSM | 2 | `security/ssm-owner-email` | M |
| 11 | SRI hashes | 2 | `security/sri-hashes` | S |
| 12 | JS cache busting | 3 | `fix/js-cache-busting` | M |
| 13 | Backfill announcements | 3 | `fix/announcement-backfill` | S |
| 14 | Magic byte validation | 4 | `feat/image-magic-byte-validation` | L |
| 15 | Pin actions to SHA | 4 | `chore/pin-actions-sha` | S |
| 16 | Build script slug guard | 4 | `fix/build-script-slug-guard` | XS |
| 17 | Dependabot | 4 | `chore/add-dependabot` | XS |
| 18 | CDK approval flag | 4 | `chore/cdk-require-approval` | XS |

**Effort key:** XS = <30 min, S = 30–90 min, M = 2–4 hrs, L = 4+ hrs (setup/arch work)
