# Plan: Knead & Bake iOS App

## Context
Knead & Bake TX wants a companion iOS app to drive engagement, preorder convenience, and loyalty via in-app discounts. The existing website runs on AWS serverless (Lambda + API Gateway + DynamoDB). The iOS app will share the same backend but live in a separate repo. This plan covers all backend changes needed in `knead-and-bake-website` and the architecture of the new `knead-and-bake-ios` repo.

## User Requirements
- **Menu**: Live inventory-aware product browsing
- **News + Social**: News posts from backend + Instagram feed + social links
- **Preorders**: Full order + payment flow (guest or authenticated)
- **Coupon/Savings**: Admin-configurable discount on app preorders; in-store coupon screen
- **Optional accounts**: Save info and view order history
- **Order status tracking**: Check preorder status in-app
- **Saved favorites**: Quick reorder from past items
- **Push notifications**: News, market reminders, order confirmations
- **Two repos**: `knead-and-bake-website` (existing) + `knead-and-bake-ios` (new)

---

## Phase 1: Backend Changes (`knead-and-bake-website`)

### 1.1 New SSM Parameters
- `/knead-bake/app-discount-percent` — integer (e.g., `10`), admin-adjustable without app release
- `/knead-bake/app-secret-token` — shared secret; iOS app sends in `X-App-Token` header to claim discount
- `/knead-bake/apns-key-id` — APNs key for push notifications
- `/knead-bake/apns-team-id` — Apple Developer team ID
- `/knead-bake/apns-private-key` — APNs p8 private key (base64)
- `/knead-bake/instagram-access-token` — Long-lived Instagram Graph API token

### 1.2 New DynamoDB Table: `knead-bake-app-users`
Schema:
```
userId (PK)       — UUID
email             — string (GSI: email-index)
name              — string
phone             — string
pushToken         — string (APNs device token)
savedSkus         — string[] (list of SKU strings)
createdAt         — ISO8601
updatedAt         — ISO8601
```
- Point-in-time recovery enabled
- GSI on `email` for lookup during login/merge

### 1.3 New Lambda: `knead-bake-app-users`
File: `infra/lambda/app-users/index.mjs`

Routes:
- `POST /api/app/users` — register or update user (upsert by email)
- `GET /api/app/users/{userId}` — get user profile
- `PUT /api/app/users/{userId}` — update name, phone, pushToken, savedSkus
- `GET /api/app/users/{userId}/orders` — fetch user's order history by email

### 1.4 New Lambda: `knead-bake-notifications`
File: `infra/lambda/notifications/index.mjs`

Purpose: Send APNs push notifications
- Called internally by other Lambdas (order confirmed, news published, market reminder)
- Routes (admin-protected):
  - `POST /api/admin/notifications/broadcast` — send to all users with pushTokens

### 1.5 Changes to Existing Lambdas

**`infra/lambda/orders/index.mjs`**:
- Read `X-App-Token` header
- If header matches SSM `/knead-bake/app-secret-token`:
  - Fetch discount % from SSM `/knead-bake/app-discount-percent`
  - Apply discount to `totalCents`
  - Store `source: "ios_app"`, `discountPercent`, `discountCents` on order record
- After order confirmed: invoke notifications Lambda to send APNs to the ordering user

**`infra/lambda/admin/index.mjs`**:
- After `POST /api/admin/news` (publish news post): invoke notifications Lambda to broadcast "New post!" push

### 1.6 New Public Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/app/menu` | Merged menu.json + live inventory (single call for iOS) |
| POST | `/api/app/users` | Register/upsert user |
| GET | `/api/app/users/{userId}` | Get user profile |
| PUT | `/api/app/users/{userId}` | Update user (push token, favorites) |
| GET | `/api/app/users/{userId}/orders` | User order history |
| GET | `/api/orders/{orderId}/status` | Public order status lookup |
| GET | `/api/app/instagram` | Proxy Instagram feed (to hide access token) |
| GET | `/api/app/discount` | Get current app discount % (for display in app) |

### 1.7 CORS Updates
`infra/lib/api-stack.ts`: Add `/api/app/*` routes. No Origin restriction needed for mobile (apps don't send Origin headers), but explicitly allow `Content-Type` and `X-App-Token` headers.

### 1.8 Updated `infra/lib/api-stack.ts`
- Add `knead-bake-app-users` DynamoDB table resource
- Add `knead-bake-app-users` Lambda resource with env vars
- Add `knead-bake-notifications` Lambda resource
- Wire all new routes to API Gateway
- Grant new Lambdas appropriate IAM permissions (DynamoDB, SSM, APNs via HTTPS)

---

## Phase 2: iOS App Repo (`knead-and-bake-ios`)

### 2.1 Tech Stack
- **Language**: Swift 5.9+
- **UI**: SwiftUI
- **Target**: iOS 17+
- **Payment**: Square In-App Payments SDK
- **Push**: APNs (UserNotifications framework)
- **Networking**: URLSession + async/await
- **Storage**: UserDefaults (session) + Keychain (userId)

### 2.2 Repo Structure
```
knead-and-bake-ios/
├── KneadAndBake/
│   ├── App/
│   │   ├── KneadAndBakeApp.swift    — App entry, push registration
│   │   └── AppState.swift           — Global state (user, cart, discount)
│   ├── Config/
│   │   └── APIConfig.swift          — API base URL, app secret token
│   ├── Models/
│   │   ├── MenuItem.swift
│   │   ├── Order.swift
│   │   ├── AppUser.swift
│   │   ├── NewsPost.swift
│   │   └── MarketConfig.swift
│   ├── Services/
│   │   ├── APIService.swift         — All network calls
│   │   ├── OrderService.swift       — Order submission + payment
│   │   ├── UserService.swift        — Account management
│   │   └── NotificationService.swift — APNs token registration
│   ├── Views/
│   │   ├── RootTabView.swift        — 5-tab container
│   │   ├── Menu/
│   │   │   ├── MenuView.swift
│   │   │   ├── MenuItemDetailView.swift
│   │   │   └── CategoryFilterView.swift
│   │   ├── News/
│   │   │   ├── NewsListView.swift
│   │   │   └── NewsDetailView.swift
│   │   ├── Social/
│   │   │   ├── SocialView.swift     — Instagram feed + social links
│   │   │   └── InstagramPostView.swift
│   │   ├── Preorder/
│   │   │   ├── PreorderView.swift
│   │   │   ├── CartView.swift
│   │   │   ├── CheckoutView.swift
│   │   │   └── PaymentView.swift    — Square In-App Payments
│   │   ├── Savings/
│   │   │   ├── SavingsView.swift    — Coupon display for in-store
│   │   │   └── DiscountBadgeView.swift
│   │   ├── Account/
│   │   │   ├── AccountView.swift
│   │   │   ├── OrderHistoryView.swift
│   │   │   └── FavoritesView.swift
│   │   └── Shared/
│   │       ├── LoadingView.swift
│   │       └── ErrorView.swift
│   └── Resources/
│       ├── Assets.xcassets          — Brand colors, images
│       └── Info.plist
├── KneadAndBakeTests/
└── Package.swift / KneadAndBake.xcodeproj
```

### 2.3 Tab Structure
| Tab | Icon | Content |
|-----|------|---------|
| Menu | fork.knife | Product catalog with live inventory |
| Preorder | cart | Order form + Square payment |
| News | newspaper | News posts + announcements |
| Social | instagram | Instagram feed + FB/IG links |
| Savings | tag | Discount coupon + account |

### 2.4 Discount / Coupon Flow

**Online (app preorder)**:
1. App sends `X-App-Token: <secret>` header with every order request
2. Backend validates token, fetches discount % from SSM
3. Discount applied server-side; `discountCents` stored on order
4. App displays "You saved $X with the app!" on confirmation screen

**In-store (show at checkout)**:
1. Savings tab shows a branded coupon screen: "X% Off — Show this at checkout"
2. Animated shimmer/gradient prevents static screenshot sharing
3. Displays current discount % fetched from `GET /api/app/discount`
4. Optional: rotating one-time codes (phase 2 enhancement)

### 2.5 Account System (Optional)
- On first launch: app prompts to "Save your info" (optional skip)
- Creates user via `POST /api/app/users` (email-based, no password)
- `userId` stored in Keychain
- Profile page shows: saved favorites, order history, push notification prefs

### 2.6 Push Notifications
- App registers for APNs on launch, sends token to `PUT /api/app/users/{userId}`
- Triggers:
  - New news post published (broadcast)
  - Market reminder (Friday evening, via EventBridge)
  - Preorder confirmed/ready

### 2.7 Instagram Feed
- Backend proxies `GET /api/app/instagram` → calls Meta Graph API with stored token
- Response: array of `{ id, media_url, permalink, caption, timestamp }`
- Displayed in a grid in the Social tab
- Tapping a post opens Instagram app (deep link) or Safari

---

## Implementation Phases

### Phase 1 — Backend Foundation (website repo)
1. Add SSM parameters (manual setup)
2. Add `knead-bake-app-users` DynamoDB table to `api-stack.ts`
3. Create `infra/lambda/app-users/index.mjs`
4. Add `GET /api/app/menu` endpoint (merge menu.json + inventory)
5. Add `GET /api/orders/{orderId}/status` public endpoint
6. Add discount logic to `infra/lambda/orders/index.mjs`
7. Add `GET /api/app/discount` endpoint
8. Deploy backend changes

### Phase 2 — iOS Core (ios repo)
1. Xcode project setup, Square SDK, APNs entitlements
2. API service layer + models
3. Menu tab (browse + filter + live inventory)
4. Preorder tab (cart + checkout + Square payment)
5. Savings tab (coupon screen with animation)

### Phase 3 — Social + News (ios repo)
1. News tab (list + detail)
2. Add Instagram proxy Lambda to backend
3. Social tab (Instagram grid + social links)

### Phase 4 — Accounts + Notifications (both repos)
1. App-users Lambda fully wired
2. Notifications Lambda (APNs)
3. Account tab (favorites, order history)
4. Push notification triggers (order confirmed, news published, Friday reminder)

---

## Critical Files to Modify (website repo)

| File | Change |
|------|--------|
| `infra/lib/api-stack.ts` | Add table, Lambdas, routes, IAM grants |
| `infra/lambda/orders/index.mjs` | Add app token validation + discount logic |
| `infra/lambda/admin/index.mjs` | Trigger push on news publish |
| `infra/lambda/orders/menu.json` | Source of truth for `GET /api/app/menu` |

## New Files to Create (website repo)

| File | Purpose |
|------|---------|
| `infra/lambda/app-users/index.mjs` | User CRUD + order history |
| `infra/lambda/notifications/index.mjs` | APNs push sender |
| `infra/lambda/menu/index.mjs` | Merged menu + inventory endpoint |
| `infra/lambda/instagram/index.mjs` | Instagram Graph API proxy |

---

## Verification

### Backend
1. `npm run build` in `infra/` — TypeScript compiles
2. `npm run synth` — CDK template generates without errors
3. `npm run diff` — review infra delta before deploy
4. Manual API test: `curl GET /api/app/menu` returns merged data
5. Manual order test with `X-App-Token` header — confirm discount applied

### iOS
1. Build succeeds in Xcode (no warnings)
2. Simulator: full preorder flow completes with discount confirmation
3. Device: APNs token registered, push received on news post publish
4. Coupon screen: animated gradient renders, discount % matches backend value

---

## Risks / Open Items
- Instagram Graph API token expires every 60 days — need refresh logic or a long-lived token automation
- Square In-App Payments SDK for iOS requires Apple Developer account + entitlements
- APNs requires paid Apple Developer Program membership
- SES is in sandbox mode — production email verification needed before launch
- App Store review requires privacy policy and data usage disclosures
