# Draft News Post — Ready to Publish
**Date:** 2026-04-27  
**Topic:** Seasonal / Holiday — Mother's Day Gifting + Sourdough Starter Jars  

---

## PUBLISH COMMAND

The `knead-bake-mcp-server` plugin was not connected during the scheduled run, so automatic publishing was skipped. Use the fields below to publish manually via the admin panel, or ensure the MCP plugin is connected in Cowork settings before the next scheduled run.

---

## Post Fields

**title:** `The Sourdough Gift She'll Actually Use`

**subtitle:** `Mother's Day is May 10 — here's what bakers (and bread lovers) actually want`

**excerpt:** `Most Mother's Day gifts get set on a shelf. A sourdough starter jar gets fed, named, and passed down. Here's why living bread makes the most meaningful gift we know how to give.`

**startDate:** `2026-04-27`

---

## Content (Markdown)

```markdown
Every year around this time, people wander up to our table at the Castell Street Market and ask some version of the same question: "What should I get my mom?"

We have an answer. We've had it for a while.

## The Gift That Stays Alive

A sourdough starter jar isn't a typical gift. It doesn't get unwrapped and then forgotten in a junk drawer. It needs attention — a little flour, a little water, every few days — and that's exactly what makes it meaningful. You're giving someone a living thing, and a reason to bake.

Our starter jars go out with feeding instructions that are written for real people, not professional bakers. If your mom has never baked sourdough before, that's completely fine. The instructions walk her through it from the first feed. If she's already baking, she gets a well-established culture with years of character built in — something she can fold into her own routine immediately.

We've had customers come back and tell us their mothers have been keeping their starter going for over a year. A few have started baking loaves every weekend. One person told us their mom named hers. We don't ask what the name is — that feels private — but we love knowing it has one.

## For the Mom Who Already Loves Bread

If the person you're buying for is more of a bread *eater* than a bread *baker*, a fresh loaf is the move. We bake every Friday night for the Saturday market, which means whatever you pick up on May 9 will be less than 24 hours out of the oven.

A few combinations that make excellent gifts:

**Cinnamon Brown Sugar** is the one people describe as "dangerous." It toasts beautifully, it makes incredible French toast, and it disappears faster than any other loaf we make. If you're bringing it to a brunch, expect to be asked where you got it.

**Lemon Blueberry** is bright and tangy with fruit folded into every slice — more of a treat loaf than an everyday sandwich bread, which makes it feel like a gift rather than a grocery run.

**Orange Cranberry Walnut** has a little bit of everything: citrus sweetness, tart cranberry, crunch from the walnuts. It's the most complex flavor we offer, and it pairs beautifully with soft cheeses or just a thin layer of butter.

## A Note on Preordering

Mother's Day weekend market is one of our busiest markets of the year, and the loaves people specifically want for gifting — the sweeter flavors especially — tend to go early. If you have a specific loaf in mind, **preorder by Friday evening at kneadandbaketx.com/preorder.html** and we'll have it waiting for you.

Walk-ups are always welcome, but we bake in small batches and can't guarantee availability on the day.

## Come See Us

We'll be at the **Castell Street Market on Saturday, May 9 from 9 AM to 1 PM** — Mother's Day weekend, right there in New Braunfels. If you're shopping for a gift or just want something good for the table, we'll be there.

Bring your mom if you can. We like meeting the people our bread is baked for.

*Find us at the Castell Street Market every Saturday, 9 AM – 1 PM. Preorder at kneadandbaketx.com/preorder.html*
```

---

## Notes

- **Plugin status:** `knead-bake-mcp-server` was not connected during the April 27 scheduled run. `publish_news_post` could not be called.
- **API blocker:** The API gateway domain (`3db1s4oqy5.execute-api.us-east-1.amazonaws.com`) is not on the Cowork network allowlist for sandbox/scheduled sessions. This is a recurring issue — see also `draft-news-post-2026-04-20.md`.
- **Fix needed:** For automated publishing to work, either (a) add the API gateway domain to the Cowork network allowlist in Settings → Capabilities, or (b) proxy the API through `kneadandbaketx.com/api/...` via CloudFront so it's on the allowed domain.
- **Topic coverage:** "Seasonal / Holiday — Mother's Day" (May 10, 2026). Chose starter jars + sweet loaf gifting angle. Could not verify recent published posts to confirm no overlap — check admin panel before publishing.
- **Also outstanding:** `draft-news-post-2026-04-20.md` (Cinco de Mayo / Jalapeño Cheddar) may also still need publishing. Verify before posting both to avoid flooding the news feed.
