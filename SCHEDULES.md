# Scheduled Tasks

All scheduled jobs run via AWS EventBridge rules targeting Lambda functions.
Timezone reference: CDT = UTC−5 (standard), UTC−6 (daylight).

| Rule Name                   | UTC Cron          | Local Time (CDT)     | Target Lambda   | Purpose                                      |
|-----------------------------|-------------------|----------------------|-----------------|----------------------------------------------|
| `knead-bake-friday-preview` | `0 23 ? * FRI *`  | Friday 7:00 PM CDT   | `scheduler`     | Email owner a preview of Saturday preorders  |
| `knead-bake-saturday-morning` | `0 14 ? * SAT *` | Saturday 9:00 AM CDT | `scheduler`     | Email owner the final market-day order list  |
| `knead-bake-inventory-reset`  | `1 14 ? * SAT *` | Saturday 9:01 AM CDT | `admin`         | Auto-reset inventory to weekly defaults      |

## Details

### knead-bake-friday-preview
- **Defined:** `infra/lib/api-stack.ts:453`
- **Handler:** `infra/lambda/scheduler/index.mjs`
- Queries DynamoDB for Saturday preorders and emails the owner a formatted summary.

### knead-bake-saturday-morning
- **Defined:** `infra/lib/api-stack.ts:461`
- **Handler:** `infra/lambda/scheduler/index.mjs`
- Same handler as Friday preview; sends the final confirmed list at market open.

### knead-bake-inventory-reset
- **Defined:** `infra/lib/api-stack.ts:469`
- **Handler:** `infra/lambda/admin/index.mjs` — detects `event.source === 'aws.events'` and calls `resetAllInventory()`
- Fires one minute after market opens to reset stock for the upcoming week.
