# TODO

## Deploy Scheduled Preorder Emails

**Branch:** `claude/review-preorder-emails-Ba6za`

Changes are committed and pushed but not yet deployed to AWS.

### What was built
- New Lambda `knead-bake-scheduler` — sends preorder summary emails on a schedule
- Two EventBridge rules:
  - **Friday 7 PM CDT** → "Friday Evening Preorder Report" to allyson.m.roberts@gmail.com
  - **Saturday 9 AM CDT** → "Saturday Morning Preorder Report" to allyson.m.roberts@gmail.com

### To deploy
```bash
cd infra
npm install
npm run deploy
```

### After deploy — verify it works
You can trigger a test run manually via AWS Console:
1. Go to **Lambda → knead-bake-scheduler**
2. Create a test event with payload:
   ```json
   { "detail": { "label": "Test Preorder Report" } }
   ```
3. Run it — check allyson.m.roberts@gmail.com for the email

---

## Send One-Off Preorder Report to zachary.w.roberts@gmail.com

The AWS CLI is not available in this dev environment. Run this from your local terminal:

```bash
# Step 1 — log in
TOKEN=$(curl -s -X POST https://3db1s4oqy5.execute-api.us-east-1.amazonaws.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Step 2 — send report to Zachary
curl -X POST https://3db1s4oqy5.execute-api.us-east-1.amazonaws.com/api/admin/preorders/email-summary \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"toEmail":"zachary.w.roberts@gmail.com"}'
```

Replace `YOUR_ADMIN_PASSWORD` with your admin panel password.
