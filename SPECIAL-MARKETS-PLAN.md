# Special Market Preorders — Implementation Plan

**Status:** Phase 1 built on `feat/special-markets` (not deployed) · **Owner:** Zach · **Created:** 2026-11-09

> **Decisions (2026-11-09):** Button style **Option D: Cranberry Holiday**. **Card only.** Items come **only from current menu products**, with event-specific quantities (no custom items, so prices come from inventory). The $0.30 card fee is kept. All event fields can be edited in admin.
>
> **As built:**
> - Stock edits happen in the same Save as the event; there is no separate `/inventory` route.
> - Preview renders the unsaved form from `localStorage`, so it needs no API.
> - The button and page JS are new `?v=1` files, so the 1-year JS cache doesn't hide them.
> - Special orders are excluded from the weekly Preorders summary.
> - Email is required on special orders.
>
> **Deploy only `KneadBakeApi`.** `cdk deploy --all` would strip the custom domain (see section 7).
**First use:** Thanksgiving 2026. Preorders open Tue 11/10 and close Sat 11/21 at 11:59 PM CT.

---

## 1. Goal

Let Allyson run one-off preorder events ("Special Markets") that are separate from the normal Saturday market:

| Need | How it works |
|---|---|
| Separate calendar | New **Special Markets** admin tab. Each event has its own pickup date (any day of the week), time, and location. |
| Admin-set order window | `opensAt` / `closesAt` are set per event to the minute in Central Time (e.g. 11/10 12:00 AM → 11/21 11:59 PM). |
| 100% prepaid | Card (Square) only. No pay-at-pickup and no Venmo. **The order exists only if the charge succeeds.** |
| Separate quantities | Each event has its own stock per item. The weekly Saturday inventory and its auto-reset are never touched. |
| Distinct entry point | A **SPECIAL MARKET** button in a different color next to the normal Preorder button. It appears only while an event is announced or open. |
| Preview before go-live | Events start as **Draft**. Admin can open a **Preview** link that shows the real page with checkout turned off before publishing. |

### Acceptance criteria
1. Admin creates "Thanksgiving 2026" with dates, items, quantities, and prices, and can preview it. Nothing is public until **Publish**.
2. The public site shows the special button. Before `opensAt` it reads "Opens Tue 11/10". After `closesAt` the button disappears.
3. A customer can order only by paying with a card. A declined card creates no order and holds no stock.
4. Special stock goes down when an order is paid and goes back up when an order is rejected. Saturday inventory is unaffected.
5. Saturday preorders keep working exactly as they do today (regression check).
6. The server rejects orders before `opensAt` or after `closesAt`, even if the page is stale.

---

## 2. Data Model (no new tables)

Everything uses the existing `knead-bake-market-config` table (PK `type`, SK `id`) and `knead-bake-orders`.

### Event: `type = SPECIAL_MARKET`, `id = <slug>` (e.g. `thanksgiving-2026`)
```jsonc
{
  "type": "SPECIAL_MARKET",
  "id": "thanksgiving-2026",
  "name": "Thanksgiving Preorders",
  "tagline": "Holiday loaves for your table",
  "description": "markdown, optional",
  "status": "DRAFT",                 // DRAFT | PUBLISHED | ARCHIVED
  "announceAt": "2026-11-09T18:00:00-06:00", // button shows "Opens …" from here (optional, defaults to opensAt)
  "opensAt":    "2026-11-10T00:00:00-06:00",
  "closesAt":   "2026-11-21T23:59:59-06:00",
  "pickupDate": "2026-11-25",        // any weekday
  "pickupWindow": "9:00 AM – 12:00 PM",
  "pickupLocation": "Castell Street Market, New Braunfels",
  "pickupNotes": "Free-text shown in emails",
  "buttonLabel": "Thanksgiving Preorder", // text on the special button
  "buttonStyle": "harvest",          // chosen from the preview options
  "items": [
    { "sku": "CL-001", "name": "Classic Plain Sourdough", "price": 10, "image": "/images/menu/KnB_Loaf_Plain.png", "maxPerOrder": 6 },
    { "sku": "SP-TG26-ROLLS", "name": "Dinner Rolls (dozen)", "price": 12, "custom": true, "maxPerOrder": 4 }
  ],
  "createdAt": "...", "updatedAt": "..."
}
```
- Items can come from the menu (prefilled name, image, and price, with the price editable) or be **custom** (new name and price, with a generated SKU `SP-<event>-<slug>`).
- **The price stored on the event is the price charged.** This keeps server-side pricing authoritative, as `menu.json` does today.
- Store times in CT with an explicit offset and always compare with `new Date(iso)`. Do not use the `getCSTDate()` string trick for these comparisons.

### Stock: `type = SPECIAL_INV`, `id = <eventId>#<sku>`
```json
{ "type": "SPECIAL_INV", "id": "thanksgiving-2026#CL-001", "totalQty": 40, "currentQty": 40, "updatedAt": "..." }
```
Stock lives on separate rows rather than inside the event so that the existing `TransactWriteCommand` + `ConditionExpression: currentQty >= :qty` pattern from `orders/index.mjs` carries over unchanged. `resetAllInventory()` only queries `PRODUCT_INVENTORY`, so it can never wipe special stock.

### Order (existing `knead-bake-orders`, new fields)
```jsonc
{
  "orderType": "SPECIAL",            // absent = normal Saturday order
  "specialMarketId": "thanksgiving-2026",
  "specialMarketName": "Thanksgiving Preorders",
  "pickupDate": "2026-11-25",        // existing GSI by-pickup-date keeps working
  "status": "NEW",
  "paymentStatus": "PAID",           // PENDING_PAYMENT only for the few seconds during checkout
  "paymentMethod": "SQUARE", "squarePaymentId": "...", "processingFeeCents": 30, "totalPaidCents": 0
}
```

---

## 3. Checkout Flow (prepay-only)

Today's flow is **create order → choose payment**. For special markets the card is tokenized in the browser first, and then **one** API call reserves stock, charges the card, and confirms the order:

```
Browser: pick items → details → Square card form → tokenize → POST /api/special-orders {eventId, items, name, phone, email, notes, nonce}

Lambda (payments):
 1. Validate: event PUBLISHED, opensAt ≤ now < closesAt, items belong to event, qty ≤ maxPerOrder
 2. TransactWrite: Put order (paymentStatus=PENDING_PAYMENT) + decrement each SPECIAL_INV (condition currentQty >= qty)
      ↳ fails → 409 "Sold out while you were ordering", no charge
 3. Square CreatePayment (idempotency_key = orderId, amount = server total + $0.30 fee)
      ↳ declined → TransactWrite: delete order + restore stock → 402 with Square's message, customer can retry
 4. Update order → PAID, send customer + owner emails → 201
```
- **Why the payments Lambda?** It already has the Square credentials from SSM and write access to `ordersTable`. It only needs `configTable` read/write added.
- **Stuck holds:** if the Lambda dies between steps 2 and 4, an order is left in `PENDING_PAYMENT`. The admin tab flags these orders when they are more than 10 minutes old and has a **Release** button. An automatic sweeper is in Phase 2.
- Raise the payments Lambda timeout from 15s to 20s. Square calls are usually under 2s.

---

## 4. API Changes

| Route | Lambda | Auth | Purpose |
|---|---|---|---|
| `GET /api/market-config` (existing) | admin | public | Add `specialMarkets: [{id, name, buttonLabel, buttonStyle, opensAt, closesAt, pickupDate, state}]` for PUBLISHED events where `announceAt ≤ now < closesAt`. Every page already fetches this, so the nav button costs no extra request. |
| `GET /api/special-markets/{id}` | admin | public | Full event and live stock for the special page. `?preview=1` returns DRAFT events only with a valid admin token. |
| `POST /api/special-orders` | payments | public, rate-limited | Prepaid checkout (section 3). Reuse the `ORDER_RATE` limiter. |
| `GET/POST /api/admin/special-markets` | admin | admin | List and create events. |
| `PUT/DELETE /api/admin/special-markets/{id}` | admin | admin | Edit, publish, archive. DELETE is blocked if the event has orders (use archive). |
| `PUT /api/admin/special-markets/{id}/inventory` | admin | admin | Set `totalQty` per item. `currentQty` changes by the same amount so sold units stay sold. |
| `GET /api/admin/special-markets/{id}/orders` | admin | admin | Orders and per-item totals for print and baking prep. |

Existing changes:
- `rejectOrder()` in `admin/index.mjs:1295`: when `orderType === 'SPECIAL'`, restore `SPECIAL_INV` (`<eventId>#<sku>`) instead of `PRODUCT_INVENTORY`. The refund is done by hand in the Square dashboard in Phase 1. The admin confirm dialog says so.
- `orders/index.mjs`: no change. Normal orders stay Saturday-only, and special orders never go through it.
- Saturday `scheduler` reminders query by Saturday `pickupDate`, so special orders are naturally excluded. That is correct for Phase 1.

---

## 5. Admin UI: new "Special Markets" tab

Add it to `src/pages/admin.html` (both the tab bar and the mobile `<select>`) and add a module section in `src/js/admin.js`.

1. **Event list**: cards showing name, a state chip (Draft / Scheduled / Open / Closed / Archived), the order window, the pickup date, and `sold / total`.
2. **Event editor** (one form):
   - Basics: name, tagline, description, button label, button style (picker that previews the chosen option).
   - Calendar: pickup date, pickup window, location, notes, then **Preorders open** and **Preorders close** (`datetime-local`, labeled "Central Time"). Validation: opens < closes ≤ pickup date.
   - Items and quantities: an "Add from menu" dropdown plus an "Add custom item" button. Each row has name, price, **quantity available**, max per order, and remove.
   - Buttons: **Save Draft**, **Preview**, **Publish**, and **Unpublish/Archive**.
3. **Preview**: opens `/special-preorder.html?event=<id>&preview=1` in a new tab. It renders the real page with a "PREVIEW — not live" banner, and the Pay button is disabled.
4. **Orders panel** (per event): a table like the Preorders tab, item totals ("bake list"), Print, Reject (restores stock), and any stuck `PENDING_PAYMENT` orders flagged with a Release button.

Write an audit log entry for every create, update, publish, and inventory change via the existing `writeAuditLog()`.

---

## 6. Public Site

### Special button (next to Preorder)
- Render it in `nav.js` (desktop `.nav__cta` and mobile `.mobile-nav__cta`), and in the home and menu heroes next to "Preorder for Next Market". Use the data from `getMarketInfo()` (now with `specialMarkets`).
- Show it only while an event is announced or open. **Hide it entirely** when there are none, so the normal layout is unchanged.
- States: `Opens Tue 11/10` (announced) → `Thanksgiving Preorder` (open) → `Closes tonight 11:59 PM` (last 24h) → `Sold Out` (all items at 0, still links to the page).
- Add the new `.btn--special` styles to `components.css`. Allyson picks the visual style from the preview page (see the Artifact link in the PR or chat).

### New page: `src/pages/special-preorder.html`
- Copy the `preorder.html` shell. It **must include** `<script>window.__API_BASE = '...'</script>` and the Square config bootstrap.
- Header: event name, tagline, a countdown to close, and a pickup info card (date, window, location).
- Banner: **"Prepayment required — card only. Your order is confirmed when payment goes through."**
- Item list uses event prices and stock (reusing `renderOrderItem`), then the details form, then the Square card form inline, then a **Pay $X.XX & Place Order** button.
- New module `src/js/special-order-form.js`. Shared Square SDK loading code moves out of `order-form.js` into `src/js/square.js` so it isn't duplicated.
- Add it to `robots.txt` Disallow (as with `/preorder.html`).

### Emails
- Customer **"Special Preorder Confirmed — Paid"** and owner **"New Special Preorder (Paid)"**. Both use the event's pickup date, window, and location instead of the hardcoded `MARKET_LOCATION` and noon-deadline block.
- Templates live in `payments/index.mjs`, reusing `buildCustomerEmailShell`.

---

## 7. Infra (`infra/lib/api-stack.ts`)
- `configTable.grantReadWriteData(paymentFn)` and the payments timeout raised to 20s.
- Add the 7 routes from section 4 (admin routes behind the existing authorizer).
- ⚠️ **The IAM grant change will fail the CI `cdk deploy` approval step.**
- 🛑 **Don't run `npm run deploy` (`--all`).** As of 11/9, `cdk diff` shows the KneadBakeSite stack would **remove the CloudFront custom domain aliases, SSL certificate, and `/src/*` cache policy**. Those are live but not in `static-site-stack.ts`. Deploy the API only:
  `cd infra && npx cdk diff KneadBakeApi && npx cdk deploy KneadBakeApi`
- The CI `deploy-infra` job also runs `cdk deploy --all` when `infra/` changes. Before merging to `main`, either scope that job to `KneadBakeApi` or sync the site stack with what is live.

---

## 8. Build Order & Estimate

The Thanksgiving window opens **tomorrow (Tue 11/10)**, so Phase 1 is cut down to what the event needs.

| # | Step | Effort |
|---|---|---|
| 1 | Infra: grant, timeout, routes. Deploy locally. | S |
| 2 | Admin Lambda: event CRUD, inventory, public read, `market-config` extension, orders list, reject branch | M |
| 3 | Payments Lambda: `POST /api/special-orders` + emails | M |
| 4 | Admin tab: editor, items/qty, preview, publish, orders panel | M–L |
| 5 | `special-preorder.html` + `special-order-form.js` + `square.js` extraction | M |
| 6 | Special button in nav and heroes + `.btn--special` styles | S |
| 7 | Test in Square **sandbox** (approve, decline, sold-out race, closed window, reject→restock), then flip back to production | S |
| 8 | **Cache-busting (BACKLOG #12).** `nav.js` and `order-form.js` change, and returning visitors have them cached for a year. Without this they won't see the button. | S |

**Total: about 1.5–2 focused days.** Realistic go-live is **Wed 11/11–Thu 11/12**. If 11/10 is a hard date, announce on Instagram that "Thanksgiving preorders open Wednesday", or open with a slightly later `opensAt`.

### Phase 2 (after Thanksgiving)
- Automatic Square refund on reject (Square Refunds API).
- Owner "bake list" email when preorders close, and a customer reminder email the morning before pickup (scheduler).
- Automatic sweeper for stuck `PENDING_PAYMENT` orders.
- Image upload for custom items (reuse the news upload-url flow).
- "Duplicate event" button (Christmas = Thanksgiving copy with new dates).

---

## 9. Test Checklist
- [ ] Draft event is not visible publicly. Preview link works for admin only.
- [ ] Before `opensAt`: button reads "Opens …", page shows a countdown, and the API rejects orders.
- [ ] Successful card payment → order PAID, stock decreases, both emails sent.
- [ ] Declined card (sandbox `4000 0000 0000 0002`) → no order, stock unchanged, customer can retry.
- [ ] Two buyers racing for the last unit → one succeeds, the other gets 409 and is **not charged**.
- [ ] After `closesAt` (11:59:59 PM CT) → button gone, API rejects.
- [ ] Reject special order → special stock restored, weekly stock untouched.
- [ ] Saturday 9:01 AM inventory reset leaves `SPECIAL_INV` untouched.
- [ ] Normal Saturday preorder end-to-end still works (pay now + pay at pickup).
- [ ] Mobile: button fits the nav and mobile menu at 375px.

## 10. Open Questions (need answers before step 4)
1. **Thanksgiving pickup date, time, and location?** (Plan assumes Wed 11/25, 9–12, Castell St. All of these can be edited in admin.)
2. **Card only, or also accept Venmo prepay** (admin marks it paid by hand)? The plan assumes card only, because Venmo can't be enforced automatically.
3. Will there be **custom Thanksgiving items** (rolls, pie loaf, etc.), or only regular menu items with special quantities?
4. Keep the $0.30 card fee for special orders, or absorb it?
