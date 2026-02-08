# Knead & Bake TX

Production-grade website for a farmers market micro-bakery in New Braunfels, TX.
Static-first, mobile-optimized, data-driven, deployed on AWS.

---

## Architecture

```
                          ┌─────────────────┐
                          │   Route 53       │  (future: kneadandbaketx.com)
                          │   DNS            │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   CloudFront     │  CDN (us-east-1)
                          │   Distribution   │  TLS, caching, HTTP→HTTPS
                          │                  │  URL rewrite function
                          └───┬──────────┬──┘
                              │          │
                    ┌─────────▼──┐  ┌────▼──────────┐
                    │   S3       │  │  API Gateway   │
                    │   Bucket   │  │  HTTP API      │
                    │            │  │  /api/orders   │
                    │  Static    │  └────┬───────────┘
                    │  Website   │       │
                    └────────────┘  ┌────▼───────────┐
                                    │   Lambda        │
                                    │   (Node.js 22)  │
                                    └────┬──────┬────┘
                                         │      │
                                    ┌────▼──┐ ┌─▼────┐
                                    │DynamoDB│ │ SES  │
                                    │Orders  │ │Email │
                                    └───────┘ └──────┘
```

### AWS Services Used

| Service | Purpose | Region |
|---------|---------|--------|
| S3 | Static file hosting | us-east-1 |
| CloudFront | CDN, TLS, caching | Global (us-east-1) |
| ACM | TLS certificate (future) | us-east-1 |
| Route 53 | DNS (future) | Global |
| API Gateway v2 | HTTP API for orders | us-east-1 |
| Lambda | Order processing | us-east-1 |
| DynamoDB | Order storage | us-east-1 |
| SES | Email notifications | us-east-1 |
| CloudWatch | Logs & monitoring | us-east-1 |

### Caching Strategy

| Content | Cache-Control | CloudFront TTL |
|---------|--------------|----------------|
| HTML pages | `max-age=300` | 5 minutes |
| JSON data | `max-age=300` | 5 minutes |
| CSS/JS/images | `max-age=31536000, immutable` | 1 year |
| sitemap/robots | `max-age=300` | 5 minutes |

After content updates, CI/CD auto-invalidates `/*` on CloudFront.

---

## Project Structure

```
knead-and-bake-website/
├── content/                    # Editable content (JSON data files)
│   ├── site-config.json        #   Site-wide config, market dates, preorder policies
│   ├── menu.json               #   Menu items, categories, seasonal banner
│   ├── recipes.json            #   Recipe list + full recipe details
│   ├── starter-kit.json        #   4-day starter plan, supplies, FAQs
│   ├── news.json               #   Blog/news posts
│   ├── testimonials.json       #   Customer quotes
│   └── about.json              #   Story, values, allergen statement
├── src/
│   ├── css/
│   │   ├── variables.css       #   Design tokens (colors, spacing, fonts)
│   │   ├── reset.css           #   CSS reset + accessibility utilities
│   │   ├── layout.css          #   Header, footer, hero, page layouts
│   │   ├── components.css      #   Buttons, cards, forms, accordions
│   │   ├── pages.css           #   Page-specific styles
│   │   └── main.css            #   Import aggregator
│   ├── js/
│   │   ├── content-loader.js   #   Fetches + caches JSON data
│   │   ├── components.js       #   Render functions (cards, accordions, etc.)
│   │   ├── nav.js              #   Sticky header + mobile menu
│   │   ├── order-form.js       #   Preorder form logic
│   │   └── main.js             #   Entry point
│   └── pages/                  #   HTML pages
│       ├── index.html          #   Home
│       ├── about.html          #   About / Story
│       ├── menu.html           #   Full menu
│       ├── preorder.html       #   Order form
│       ├── recipes.html        #   Recipe list
│       ├── recipe-detail.html  #   Recipe detail (template)
│       ├── starter-kit.html    #   4-day starter guide
│       ├── news.html           #   News list
│       ├── news-detail.html    #   News detail (template)
│       ├── social.html         #   Social media links
│       ├── market.html         #   QR code landing page
│       └── 404.html            #   Error page
├── public/                     #   Static assets (copied to dist root)
│   ├── images/
│   │   ├── favicon.svg
│   │   ├── placeholder-bread.svg
│   │   └── og-image.jpg        #   ← Replace with real image
│   └── downloads/
│       └── sourdough-starter-cheat-sheet.pdf  # ← Replace with real PDF
├── infra/                      #   AWS CDK (TypeScript)
│   ├── bin/app.ts              #   CDK app entry
│   ├── lib/
│   │   ├── static-site-stack.ts    # S3 + CloudFront
│   │   └── api-stack.ts           # API Gateway + Lambda + DynamoDB
│   ├── lambda/orders/index.mjs    # Order Lambda handler
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json
├── scripts/
│   ├── build.js                #   Build script (copies to /dist)
│   └── serve.js                #   Local dev server
├── .github/workflows/
│   └── deploy.yml              #   CI/CD pipeline
├── package.json
├── .gitignore
└── README.md
```

---

## Quick Start (Local Development)

```bash
# No npm install needed — zero dependencies for the site itself

# Start local dev server
npm run dev
# → http://localhost:3000

# Build for production
npm run build
# → Output in /dist
```

The dev server serves pages from `src/pages/` at the root, with content data from `content/` and assets from `public/`.

---

## Deployment

### Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 22+
- An AWS account

### Step 1: Initial CDK Setup

```bash
cd infra
npm install

# Bootstrap CDK (one-time per account/region)
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1

# Review what will be created
npx cdk diff
```

### Step 2: Build the Site

```bash
# From project root
node scripts/build.js
```

### Step 3: Deploy Infrastructure

```bash
cd infra
npx cdk deploy --all
```

This creates:
- S3 bucket + CloudFront distribution (static site)
- API Gateway + Lambda + DynamoDB (order API)

Note the outputs:
- `KneadBakeSite.SiteUrl` — your CloudFront URL
- `KneadBakeApi.ApiUrl` — your API endpoint

### Step 4: Configure the Order API URL

After deployment, update the frontend to point to your API:

1. Open `src/js/order-form.js`
2. Find `const API_BASE = window.__API_BASE || '';`
3. Either:
   - Set `window.__API_BASE` in a `<script>` tag on `preorder.html`, or
   - Replace the empty string with your API URL

### Step 5: Set Up CI/CD

Add these GitHub repository secrets:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM deploy user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM deploy user secret key |
| `S3_BUCKET_NAME` | From CDK output `KneadBakeSite.BucketName` |
| `CLOUDFRONT_DISTRIBUTION_ID` | From CDK output `KneadBakeSite.DistributionId` |

### Step 6 (Optional): Enable Email Notifications

1. Verify your domain or email in SES:
   ```bash
   aws ses verify-email-identity --email-address orders@kneadandbaketx.com
   aws ses verify-email-identity --email-address noreply@kneadandbaketx.com
   ```
2. Update the Lambda environment variable:
   - Set `SEND_EMAILS=true` in the CDK stack or Lambda console
3. If in SES sandbox, request production access

### Step 7 (Future): Add Custom Domain

1. Register `kneadandbaketx.com` in Route 53
2. Request ACM certificate in us-east-1:
   ```bash
   aws acm request-certificate \
     --domain-name kneadandbaketx.com \
     --subject-alternative-names "*.kneadandbaketx.com" \
     --validation-method DNS
   ```
3. Add DNS validation records in Route 53
4. Update the CDK stack to add the certificate and domain aliases to CloudFront
5. Add Route 53 A/AAAA alias records pointing to CloudFront

---

## How to Edit Content

All content is in the `/content` directory as JSON files. Edit these files and push to deploy.

### Update the Next Market Date

Edit `content/site-config.json`:
```json
{
  "nextMarket": {
    "date": "Saturday, February 22, 2026",
    "time": "9:00 AM – 1:00 PM",
    "location": "Castell Street Market, New Braunfels",
    "preorderCutoff": "Thursday, February 20, 2026 at 8:00 PM"
  }
}
```

### Add a Menu Item

Edit `content/menu.json` → add to the `items` array:
```json
{
  "sku": "SL-004",
  "name": "Pesto Parmesan Sourdough",
  "category": "seasonal-loaves",
  "description": "Fresh basil pesto swirled through the dough with aged parmesan.",
  "price": 14.00,
  "allergens": ["wheat", "milk", "tree nuts"],
  "available": true,
  "seasonal": true,
  "seasonalLabel": "Spring Special",
  "image": "/images/menu/pesto-parmesan.jpg"
}
```

### Add a Recipe

Edit `content/recipes.json` → add to the `recipes` array. The build script auto-generates a detail page at `/recipes/YOUR-SLUG.html`.

### Add a News Post

Edit `content/news.json` → add to the `posts` array. Include a unique `slug`. The build script auto-generates a detail page at `/news/YOUR-SLUG.html`.

### Add a Testimonial

Edit `content/testimonials.json` → add to the `testimonials` array.

### Add Product Images

1. Add optimized images (WebP preferred, JPEG ok) to `public/images/menu/`
2. Reference them in `menu.json` as `/images/menu/your-image.jpg`
3. Recommended size: 800x600px, compressed to <100KB

---

## IAM Permissions (Least Privilege)

### CI/CD Deploy User

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::knead-bake-site-*",
        "arn:aws:s3:::knead-bake-site-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
    }
  ]
}
```

For CDK deployments, the user needs broader CloudFormation + service-specific permissions. Use the CDK bootstrap role for this.

---

## Verification Checklist

After deployment, verify:

- [ ] Site loads at CloudFront URL
- [ ] All pages render: Home, About, Menu, Preorder, Recipes, Starter Kit, News, Social, Market
- [ ] Mobile menu opens/closes
- [ ] Menu filters work
- [ ] Recipe and news detail pages load content
- [ ] Starter Kit accordion works
- [ ] Preorder form item selector works (+/- buttons)
- [ ] Preorder form validates required fields
- [ ] Order submission reaches DynamoDB (check table in console)
- [ ] 404 page shows for invalid URLs
- [ ] sitemap.xml and robots.txt are accessible
- [ ] HTTPS redirect works (http → https)
- [ ] Lighthouse score: aim for 90+ on Performance, Accessibility, SEO

---

## Cost Estimate (Monthly)

| Service | Estimated Cost |
|---------|---------------|
| S3 | ~$0.02 (static files) |
| CloudFront | ~$1-5 (depends on traffic) |
| Lambda | ~$0 (free tier covers light usage) |
| DynamoDB | ~$0 (free tier, on-demand) |
| API Gateway | ~$0 (free tier: 1M requests/month) |
| Route 53 | $0.50/hosted zone + $0.40/M queries |
| **Total** | **~$1-6/month** |
