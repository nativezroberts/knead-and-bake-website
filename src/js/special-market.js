/**
 * Special Market button — the cranberry "SPECIAL" button that appears next to every
 * Preorder button while a special market (e.g. Thanksgiving) is announced or open.
 *
 * Self-contained on purpose (own fetch + own styles): JS/CSS are cached for a year, so this
 * file is loaded with a ?v= query and must not depend on changes to other cached files.
 * Renders nothing when no special market is live, so the normal layout is unchanged.
 */

const API_BASE = window.__API_BASE || '';
const TZ = 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

const STYLES = `
.kb-special-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; background:#8E2B3A; color:#FFF4E6 !important;
  box-shadow:inset 0 0 0 1px rgba(232,200,114,.55); text-decoration:none; white-space:nowrap; }
.kb-special-btn:hover, .kb-special-btn:focus-visible { background:#6E1F2C; color:#FFF4E6; }
.kb-special-btn__tag { font-size:.68em; font-weight:700; letter-spacing:.1em; text-transform:uppercase; line-height:1;
  padding:3px 7px; border-radius:999px; border:1px solid #E8C872; color:#E8C872; }
.kb-special-btn__dot { width:8px; height:8px; border-radius:50%; background:#E8C872; flex:none; animation:kbSpecialPulse 1.8s infinite; }
.kb-special-btn.is-soldout { opacity:.65; }
.kb-special-btn.is-soldout .kb-special-btn__dot { animation:none; background:#C9A9AE; }
.kb-special-btn.is-announced .kb-special-btn__dot { animation:none; }
.nav .kb-special-btn { margin-left:8px; }
.mobile-nav__panel .kb-special-btn { width:100%; margin-top:12px; white-space:normal; }
@media (max-width:1279px) { .nav .kb-special-btn .kb-special-btn__tag { display:none; } }
@keyframes kbSpecialPulse { 0% { box-shadow:0 0 0 0 rgba(232,200,114,.6); } 70% { box-shadow:0 0 0 7px rgba(232,200,114,0); } 100% { box-shadow:0 0 0 0 rgba(232,200,114,0); } }
@media (prefers-reduced-motion: reduce) { .kb-special-btn__dot { animation:none; } }
`;

function ctDayKey(ms) {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: TZ });
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric' });
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function buttonLabel(sm, now = Date.now()) {
  const opens = Date.parse(sm.opensAt);
  const closes = Date.parse(sm.closesAt);
  if (sm.state === 'soldout') return { text: `${sm.buttonLabel} · Sold Out`, cls: 'is-soldout' };
  if (now < opens) return { text: `${sm.buttonLabel} · Opens ${shortDate(sm.opensAt)}`, cls: 'is-announced' };
  if (closes - now <= DAY_MS) {
    const when = ctDayKey(closes) === ctDayKey(now) ? 'tonight' : shortDate(sm.closesAt);
    return { text: `${sm.buttonLabel} · Closes ${when} ${shortTime(sm.closesAt)}`, cls: 'is-closing' };
  }
  return { text: sm.buttonLabel, cls: 'is-open' };
}

function makeButton(sm, sizeClasses) {
  const { text, cls } = buttonLabel(sm);
  const a = document.createElement('a');
  a.href = `/special-preorder.html?event=${encodeURIComponent(sm.id)}`;
  a.className = `btn ${sizeClasses} kb-special-btn ${cls}`;
  a.dataset.kbSpecial = '1';
  a.setAttribute('aria-label', `Special market: ${text}`);

  if (cls !== 'is-soldout') {
    const dot = document.createElement('span');
    dot.className = 'kb-special-btn__dot';
    dot.setAttribute('aria-hidden', 'true');
    a.appendChild(dot);
  }
  const tag = document.createElement('span');
  tag.className = 'kb-special-btn__tag';
  tag.textContent = 'Special';
  a.appendChild(tag);
  const label = document.createElement('span');
  label.textContent = text;
  a.appendChild(label);
  return a;
}

function insertAfter(ref, node) {
  ref.parentNode.insertBefore(node, ref.nextSibling);
}

async function initSpecialMarketButton() {
  let sm;
  try {
    const res = await fetch(`${API_BASE}/api/market-config`);
    if (!res.ok) return;
    const data = await res.json();
    sm = (data.specialMarkets || [])[0];
  } catch {
    return;
  }
  if (!sm) return;

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  const onSpecialPage = window.location.pathname.startsWith('/special-preorder');

  document.querySelectorAll('.nav__cta').forEach(el => {
    if (!onSpecialPage) insertAfter(el, makeButton(sm, 'btn--sm'));
  });
  document.querySelectorAll('.mobile-nav__cta').forEach(el => {
    if (!onSpecialPage) insertAfter(el, makeButton(sm, 'btn--lg btn--full'));
  });
  // Big "Preorder for Next Market" style buttons on home, menu, market pages
  document.querySelectorAll('main a.btn--lg[href="/preorder.html"]').forEach(el => {
    insertAfter(el, makeButton(sm, 'btn--lg'));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSpecialMarketButton);
} else {
  initSpecialMarketButton();
}
