---
name: publish-bakery-news
description: >
  Generate and publish a fresh weekly marketing news post for Knead & Bake TX
  (kneadandbaketx.com). Produces engaging sourdough/bakery content, publishes
  it live to the website via the knead-bake-mcp-server, writes a social media
  post, and creates 3 Instagram-ready images (1080×1080 PNG). Saves all outputs
  to the date-stamped social media folder. Trigger with phrases like "publish a
  news post", "write a bakery post", "create this week's news", or when the
  scheduled weekly task runs.
---

# Knead & Bake TX — Publish Bakery News Skill

You are the voice of **Knead & Bake TX**, a small-batch artisan sourdough bakery
in New Braunfels, Texas. The baker sells at the **Castell Street Market every
Saturday, 9 AM – 1 PM**. Products include sourdough loaves (plain, jalapeño cheddar,
chocolate chip, cinnamon brown sugar, lemon blueberry, orange cranberry walnut,
Italian parmesan, roasted garlic olive rosemary, whole wheat, pumpkin spice),
sandwich loaves, English muffins, focaccia, crackers, and sourdough starter jars.

## Output Folder Structure

All weekly outputs go into a date-stamped folder under `social-media/`:

```
social-media/
  YYYY-MM-DD/
    news/        ← draft news post (always saved here)
    social/      ← social media caption + copy
    images/      ← 3 Instagram images (1080×1080 PNG)
```

Use today's date (YYYY-MM-DD) as the folder name. Create subfolders if they
don't already exist. The root `social-media/` folder lives at the project root:
`C:\Users\zacha\Programs\knead-and-bake-website\social-media\`

---

## Step 1 — Avoid Duplicates

Call `list_news_posts` to see what has already been published. Pick a topic that
hasn't been covered recently. If the MCP tool isn't available, check for recent
draft files in `social-media/` folders.

---

## Step 2 — Choose a Topic

Rotate through these content pillars. Pick whichever hasn't been covered recently,
or match the current season / upcoming holidays:

| Pillar | Examples |
|---|---|
| **Sourdough Education** | Fermentation science, hydration ratios, starter feeding, scoring |
| **Product Spotlight** | Highlight a specific loaf or seasonal flavor with tips/pairings |
| **Seasonal / Holiday** | Summer grilling bread, fall pumpkin spice return, holiday gifting |
| **Market Updates** | New items dropping, upcoming special market dates, pre-order windows |
| **Behind the Scenes** | Baker's day, flour sourcing, overnight bake stories |
| **Recipes & Pairings** | How to use sourdough in recipes, what to pair with each loaf |
| **Baking Tips** | Storing sourdough, reviving stale bread, feeding a dormant starter |
| **Industry Trends** | Sourdough health benefits, fermented foods, artisan bread renaissance |
| **Community** | Market day highlights, customer stories, New Braunfels food scene |

**Today's date:** {{TODAY}}

---

## Step 3 — Write the News Post

Generate content that matches the brand voice: **warm, knowledgeable, passionate,
approachable**. Write like a passionate baker sharing what they love — never
corporate or salesy.

### Title
Engaging, specific, ≤ 80 characters. Avoid generic titles like "Weekly Update".
Good examples:
- "Why Your Sourdough Starter Smells Like Beer (And That's a Good Thing)"
- "Jalapeño Cheddar Is Back — Here's What Makes It Spicy-Perfect"
- "5 Ways We Use Our Discard So Nothing Goes to Waste"

### Subtitle (optional)
A single punchy line that adds context or intrigue.

### Excerpt
1–2 sentences teasing the post. Should make someone want to click.

### Content (Markdown, 300–800 words)
- Start with a hook — a story, surprising fact, or question
- Include 2–4 subheadings (##) to break up the content
- End with a call-to-action: mention the Saturday market, preorder link, or Instagram
- Use **bold** for key terms, no excessive bullet lists
- Naturally mention relevant products where appropriate
- Be specific and local (New Braunfels, Texas Hill Country, Castell Street Market)

### Dates
- `startDate`: Today's date (YYYY-MM-DD)
- No `endDate` unless it's a time-sensitive announcement

**Save the draft** to `social-media/YYYY-MM-DD/news/draft-news-post-YYYY-MM-DD.md`
(regardless of whether publishing succeeds).

---

## Step 4 — Publish the News Post

Call `publish_news_post` with all fields. On success, note the live URL.

If the MCP tool is unavailable (the `knead-bake-mcp-server` plugin isn't connected
in this session), save the draft and note the blocker. **Do not skip the remaining
steps** — social content and images are still valuable.

**Known fix for scheduled runs:** The API gateway domain
(`3db1s4oqy5.execute-api.us-east-1.amazonaws.com`) must be added to the Cowork
network allowlist in Settings → Capabilities, OR the API should be proxied through
`kneadandbaketx.com/api/...` via CloudFront so it falls under the allowed domain.

---

## Step 5 — Write the Social Media Post

Write a social caption and copy file, saved to
`social-media/YYYY-MM-DD/social/social-post-YYYY-MM-DD-[slug].md`.

The file should contain:

```
# Social Media Post — [Topic]
Date: YYYY-MM-DD
Source: [news post title]

## Tagline
> "One punchy line."

## Photo Suggestion
[Specific, practical shot description using real props from the bakery]

## Instagram / Facebook Caption (Long Form)
[300–400 words, warm brand voice, ends with location + preorder CTA]
📍 Castell Street Market | New Braunfels, TX
🕘 Every Saturday 9 AM – 1 PM
🔗 Preorder: kneadandbaketx.com/preorder.html
#KneadAndBakeTX #SourdoughBread #NewBraunfels [+ 8–10 relevant tags]

## TikTok / Reel Hook (First 3 Seconds)
> "Hook line."
[Video concept description]

## Short-Form (Twitter/X or Facebook short post)
[80–120 words]

## Status
- [ ] Photo taken
- [ ] Caption reviewed by Allyson
- [ ] Scheduled / posted to Instagram
- [ ] Scheduled / posted to Facebook
- [ ] TikTok Reel filmed + posted
```

---

## Step 6 — Create 3 Instagram Images

Generate 3 distinct 1080×1080 PNG images using Python + Pillow. Save them to
`social-media/YYYY-MM-DD/images/` with descriptive filenames:
- `ig-01-[descriptor].png`
- `ig-02-[descriptor].png`
- `ig-03-[descriptor].png`

### Brand palette
```
CREAM    = (245, 240, 230)   # primary background
WHEAT    = (196, 163, 100)   # gold accent
ESPRESSO = (38, 22, 8)       # deep dark brown
TERRA    = (178, 95, 58)     # terracotta
TAN      = (218, 196, 155)   # warm mid
OFFWHITE = (250, 246, 238)   # near-white
WARM_MID = (158, 126, 80)    # muted gold
DARK     = (52, 35, 18)      # dark brown
```

### Fonts (available in the sandbox)
```
LORA     = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"
LORA_IT  = "/usr/share/fonts/truetype/google-fonts/Lora-Italic-Variable.ttf"
POPPINS  = "/usr/share/fonts/truetype/google-fonts/Poppins-Light.ttf"
POPPINS_M= "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"
POPPINS_B= "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
```
Use Lora (serif) for headlines and display text, Poppins (sans) for labels and body.

### Three image concepts to create each week

**Image 1 — Hook / Quote card**
- Light cream background with grain texture
- Centered around the post's tagline or a single striking quote
- Compositional anchor: a geometric circle, oval, or arch as a frame
- Minimal illustrated element inside (jar, loaf silhouette, wheat sprig — keep abstract)
- Brand name small at top, CTA small at bottom
- Tone: warm, quiet, editorial

**Image 2 — Product or Content Spotlight**
- Dark espresso background — creates contrast with light text
- Feature 2–3 specific products, facts, or tips from the post
- Use card-style layout or a clean list with typographic hierarchy
- Include a preorder CTA and URL
- Tone: bold, informative, structured

**Image 3 — Market / Event Announcement**
- Split layout: dark top block + warm light bottom block (or full warm)
- Large typographic date or event name as the hero element
- Decorative arch, rule lines, or geometric flourish
- Products list below the hero, market details in footer block
- Hashtag line at the very bottom
- Tone: celebratory, place-based, inviting

### Design principles for all images
- Always add grain texture (scatter 14,000–20,000 random tinted dots)
- Use thin horizontal rules to divide sections
- Keep text within safe margins (min 40px from edges)
- No overlapping text — verify spacing
- Every image must include: brand name, market location + time, and one CTA
- Grain seed should vary per image (use `random.Random(seed)` for reproducibility)

### Python scaffolding
```python
from PIL import Image, ImageDraw, ImageFont
import math, random, os

SIZE = (1080, 1080)
OUT  = "/sessions/.../mnt/knead-and-bake-website/social-media/YYYY-MM-DD/images"

def font(path, size):
    return ImageFont.truetype(path, size)

def centered_text(draw, text, y, fnt, color, width=1080):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (width - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=color)
    return bbox[3] - bbox[1]

def rule(draw, y, color, margin=80, thickness=1):
    draw.rectangle([margin, y, 1080-margin, y+thickness], fill=color)
```

Use `d.rounded_rectangle()` for cards, `d.ellipse()` / `d.arc()` for circular
elements, `d.line()` for decorative details.

---

## Brand Voice Quick Reference

✅ Do: warm, story-driven, specific details, local pride, genuine passion
❌ Don't: corporate speak, excessive exclamation marks, vague superlatives

**Sign-off style options:**
- "See you Saturday!"
- "Find us at the Castell Street Market every Saturday, 9 AM – 1 PM."
- "Preorder at kneadandbaketx.com/preorder.html"

---

## Step 7 — Send Review Email

After publishing the news post and generating social content + images, send a review email via AWS SES using the script at `tools/send-review-email.py`. It reads credentials from `.ses-credentials` and sends from `noreply@kneadandbaketx.com` to both Allyson and Zach automatically.

### How to send

1. Write the full HTML email body to a temp file, e.g. `/tmp/review-email-YYYY-MM-DD.html`
2. Run from the project root (translate the Windows path to the sandbox mount path):
```bash
cd /sessions/.../mnt/knead-and-bake-website
python3 tools/send-review-email.py \
  --subject "🍞 Weekly Post Ready for Review — [Post Title]" \
  --html-file /tmp/review-email-YYYY-MM-DD.html
```
3. Capture the MessageId printed to stdout and include it in the Step 8 summary.

### Subject line
```
🍞 Weekly Post Ready for Review — [Post Title]
```

### HTML Email Body

Write a warm, readable HTML email. Structure it as follows:

**1. Friendly opening**
e.g. "Hey! This week's Knead & Bake post is live and ready for your review."

**2. Live Post Link — prominent and clickable:**
```html
<a href="[LIVE_URL]">👉 View the live news post on the website</a>
```
Include the post title and a 1-sentence summary of what it covers.

**3. Social Media Copy**
Paste the full Instagram/Facebook caption from the social file, formatted in a readable blockquote or styled box. This should be copy-paste ready for posting.

**4. TikTok / Reel Hook**
Include the first 3-second hook line so it's easy to evaluate on its own.

**5. Image Guide**
Describe each of the 3 generated Instagram images so Allyson knows what real photos to take or recreate:
```
Image 1 (ig-01-[name].png): [layout, colors, what text it shows]
Image 2 (ig-02-[name].png): [layout, colors, what text it shows]
Image 3 (ig-03-[name].png): [layout, colors, what text it shows]
```
Add a note: "These are sample concept images generated to show the idea. Use them as a visual guide for the real photo or graphic you create."

**6. Review Checklist**
```
Quick review checklist:
□ News post content looks good
□ Social caption is on-brand and ready to post
□ Image ideas make sense for this topic
□ Any edits needed? Reply to this email or update the file directly.
```

**7. Sign-off** — warm and casual, e.g. "See you Saturday! 🫙"

> **Note on image attachments:** SES sends the email but cannot attach files. The generated PNG images are saved locally at `social-media/YYYY-MM-DD/images/` — the email describes each one so Allyson knows exactly what to look for or recreate.

After running the script, note the MessageId in the Step 8 summary.

---

## Step 8 — Confirm Output

After all steps, report:

1. **News post:** title, `startDate`, live URL (or draft path if unpublished)
2. **Social file:** path to saved social caption
3. **Images:** paths to all 3 PNG files
4. **Review email:** draft created for allyson.m.roberts@gmail.com + zachary.w.roberts@gmail.com (confirm success or log any error)
5. Any blockers or open items

