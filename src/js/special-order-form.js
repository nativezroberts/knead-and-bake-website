/**
 * Special Market order page — prepaid card checkout for one-off events.
 *
 * URL: /special-preorder.html?event=<id>   (live)
 *      /special-preorder.html?preview=1    (admin preview from localStorage, checkout disabled)
 *      /special-preorder.html              (falls back to the first live special market)
 *
 * Imported with a ?v= query from the page so cache-busting is explicit (JS is cached 1 year).
 */

import { escapeHtml } from './components.js';

const API_BASE = window.__API_BASE || '';
const TZ = 'America/Chicago';
const PROCESSING_FEE_CENTS = 30;
const PREVIEW_KEY = 'kb_special_preview';

const $ = (id) => document.getElementById(id);

function show(el, visible = true) { if (el) el.hidden = !visible; }

function formatPickupDate(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatCT(iso, opts = {}) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts,
  });
}

function formatCountdown(ms) {
  if (ms <= 0) return '0m';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function money(dollars) { return `$${Number(dollars).toFixed(2)}`; }

// ── Square ──
let squareSdkPromise = null;
async function loadSquare() {
  const res = await fetch(`${API_BASE}/api/payments/config`);
  if (!res.ok) throw new Error('Payment system is unavailable right now.');
  const cfg = await res.json();
  if (!window.Square) {
    squareSdkPromise = squareSdkPromise || new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = cfg.sdkUrl || (cfg.environment === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js');
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the payment form.'));
      document.head.appendChild(script);
    });
    await squareSdkPromise;
  }
  const payments = window.Square.payments(cfg.applicationId, cfg.locationId);
  const card = await payments.card();
  await card.attach('#sp-card-container');
  return card;
}

// ── Data loading ──
async function loadEvent({ preview, eventId }) {
  if (preview) {
    try {
      const raw = localStorage.getItem(PREVIEW_KEY);
      if (raw) return { event: JSON.parse(raw) };
    } catch { /* fall through */ }
    return { error: 'Open Preview from the admin Special Markets tab.' };
  }

  let id = eventId;
  if (!id) {
    try {
      const res = await fetch(`${API_BASE}/api/market-config`);
      const data = res.ok ? await res.json() : {};
      id = data.specialMarkets?.[0]?.id;
    } catch { /* ignore */ }
    if (!id) return { error: 'There are no special preorders right now.' };
  }

  const res = await fetch(`${API_BASE}/api/special-markets/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.message || 'This special preorder is not available.' };
  return { event: data.specialMarket };
}

export async function initSpecialOrderPage() {
  const params = new URLSearchParams(window.location.search);
  const preview = params.get('preview') === '1';
  const { event: ev, error } = await loadEvent({ preview, eventId: params.get('event') });

  show($('sp-loading'), false);
  show($('sp-preview-banner'), preview);

  if (!ev) {
    $('sp-unavailable-msg').textContent = error;
    show($('sp-unavailable'));
    return;
  }

  // ── Static content ──
  document.title = `${ev.name} | Knead & Bake TX`;
  $('sp-title').textContent = ev.name;
  $('sp-tagline').textContent = ev.tagline || 'Limited quantities. Prepaid by card.';
  $('sp-pickup-date').textContent = [formatPickupDate(ev.pickupDate), ev.pickupWindow].filter(Boolean).join(' · ');
  $('sp-pickup-where').textContent = ev.pickupLocation || 'Castell Street Market, New Braunfels';
  if (ev.pickupNotes) { $('sp-pickup-notes').textContent = ev.pickupNotes; show($('sp-pickup-notes')); }
  if (ev.description) { $('sp-description').textContent = ev.description; show($('sp-description')); }
  show($('sp-content'));

  // ── Items ──
  const items = (ev.items || []).map(i => ({ ...i, limit: Math.max(0, Math.min(Number(i.currentQty || 0), Number(i.maxPerOrder || 10))) }));
  const quantities = Object.fromEntries(items.map(i => [i.sku, 0]));
  const container = $('sp-items');

  container.innerHTML = items.length ? items.map(item => {
    const name = escapeHtml(item.name);
    const sku = escapeHtml(item.sku);
    if (item.currentQty <= 0) {
      return `<div class="order-item order-item--sold-out" data-sku="${sku}">
        <div class="order-item__info"><div><div class="order-item__name">${name}</div>
        <span class="badge badge--sold-out" style="font-size:var(--text-xs)">SOLD OUT</span></div>
        <div class="order-item__price">${money(item.price)}</div></div></div>`;
    }
    const left = item.currentQty <= 5
      ? `<span style="color:var(--color-warning, #b45309);font-size:var(--text-xs)">Only ${item.currentQty} left</span>`
      : `<span class="sp-max">Limit ${item.maxPerOrder} per order</span>`;
    return `<div class="order-item" data-sku="${sku}">
      <div class="order-item__info"><div><div class="order-item__name">${name}</div>${left}</div>
      <div class="order-item__price">${money(item.price)}</div></div>
      <div class="order-item__qty">
        <button type="button" class="order-item__qty-btn" data-action="decrement" aria-label="Remove one ${name}">&minus;</button>
        <span class="order-item__qty-val" data-qty>0</span>
        <button type="button" class="order-item__qty-btn" data-action="increment" aria-label="Add one ${name}">+</button>
      </div></div>`;
  }).join('') : '<p style="color:var(--text-secondary)">No items have been added yet.</p>';

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.order-item__qty-btn');
    if (!btn || !canOrder) return;
    const row = btn.closest('.order-item');
    const item = items.find(i => i.sku === row.dataset.sku);
    if (!item) return;
    const next = quantities[item.sku] + (btn.dataset.action === 'increment' ? 1 : -1);
    quantities[item.sku] = Math.max(0, Math.min(next, item.limit));
    row.querySelector('[data-qty]').textContent = quantities[item.sku];
    updateSummary();
  });

  // ── Window / state ──
  const opensMs = Date.parse(ev.opensAt);
  const closesMs = Date.parse(ev.closesAt);
  let canOrder = false;

  function currentPhase() {
    const now = Date.now();
    if (Number.isNaN(opensMs) || Number.isNaN(closesMs)) return 'open';
    if (now < opensMs) return 'before';
    if (now >= closesMs) return 'closed';
    return items.some(i => i.currentQty > 0) ? 'open' : 'soldout';
  }

  function renderStatus() {
    const phase = currentPhase();
    const now = Date.now();
    const label = $('sp-status-label');
    const value = $('sp-status-value');
    const detail = $('sp-status-detail');
    if (phase === 'before') {
      label.textContent = 'Preorders open in';
      value.textContent = formatCountdown(opensMs - now);
      detail.textContent = `Opens ${formatCT(ev.opensAt)} · Closes ${formatCT(ev.closesAt)}`;
    } else if (phase === 'closed') {
      label.textContent = 'Preorders are closed';
      value.textContent = 'Thank you!';
      detail.textContent = `Closed ${formatCT(ev.closesAt)}`;
    } else if (phase === 'soldout') {
      label.textContent = 'Sold out';
      value.textContent = 'Everything has been claimed';
      detail.textContent = 'Watch our Instagram for walk-up availability.';
    } else {
      label.textContent = 'Preorders close in';
      value.textContent = Number.isNaN(closesMs) ? '—' : formatCountdown(closesMs - now);
      detail.textContent = Number.isNaN(closesMs) ? '' : `Closes ${formatCT(ev.closesAt)} (Central)`;
    }
    return phase;
  }

  // ── Summary + pay button ──
  const payBtn = $('sp-pay-btn');
  const errorEl = $('sp-error');

  function selected() {
    return items.filter(i => quantities[i.sku] > 0).map(i => ({ ...i, qty: quantities[i.sku] }));
  }

  function updateSummary() {
    const sel = selected();
    const subtotal = sel.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal + PROCESSING_FEE_CENTS / 100;
    $('sp-summary').innerHTML = sel.length ? `
      <ul style="list-style:none;margin-bottom:var(--space-3)">
        ${sel.map(i => `<li style="display:flex;justify-content:space-between;padding:var(--space-2) 0;font-size:var(--text-sm);border-bottom:1px solid var(--border-color)">
          <span>${i.qty}&times; ${escapeHtml(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}
      </ul>
      <div class="sp-fee-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="sp-fee-row"><span>Card processing fee</span><span>${money(PROCESSING_FEE_CENTS / 100)}</span></div>
      <div class="sp-total-row"><span>Total due now</span><span>${money(total)}</span></div>`
      : '<p style="color:var(--text-secondary);font-size:var(--text-sm)">Select items to build your order.</p>';

    if (preview) {
      payBtn.disabled = true;
      payBtn.textContent = sel.length ? `Pay ${money(total)} & Place Order (preview)` : 'Checkout is off in preview';
    } else if (!canOrder) {
      payBtn.disabled = true;
    } else {
      payBtn.disabled = sel.length === 0 || !squareCard;
      payBtn.textContent = sel.length ? `Pay ${money(total)} & Place Order` : 'Select items to continue';
    }
  }

  function applyPhase(phase) {
    canOrder = phase === 'open' || preview;
    const form = $('sp-form');
    form.querySelectorAll('input, textarea').forEach(el => { el.disabled = !canOrder && !preview; });
    container.querySelectorAll('.order-item__qty-btn').forEach(b => { b.disabled = !canOrder; });
    if (!preview) {
      if (phase === 'before') payBtn.textContent = `Opens ${formatCT(ev.opensAt)}`;
      if (phase === 'closed') payBtn.textContent = 'Preorders closed';
      if (phase === 'soldout') payBtn.textContent = 'Sold out';
    }
    updateSummary();
  }

  let squareCard = null;
  let phase = renderStatus();
  applyPhase(phase);

  // Re-check every 30s: open the form when the window opens, lock it when it closes
  setInterval(() => {
    const next = renderStatus();
    if (next !== phase) {
      if (next === 'open' && !squareCard && !preview) { window.location.reload(); return; }
      phase = next;
      applyPhase(phase);
    }
  }, 30000);

  if (phase === 'open' && !preview) {
    try {
      squareCard = await loadSquare();
      updateSummary();
    } catch (err) {
      console.error('Square init error:', err);
      showError(`${err.message || 'The payment form could not load.'} Please refresh the page to try again.`);
    }
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  // ── Submit ──
  $('sp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (preview || !canOrder || !squareCard) return;
    if ($('sp-website').value) return; // honeypot

    errorEl.classList.add('hidden');
    const sel = selected();
    const name = $('sp-name').value.trim();
    const phone = $('sp-phone').value.trim();
    const email = $('sp-email').value.trim();
    const notes = $('sp-notes').value.trim();

    if (!sel.length) return showError('Select at least one item.');
    if (name.length < 2) return showError('Please enter your name.');
    if (phone.replace(/\D/g, '').length < 10) return showError('Please enter a valid phone number (at least 10 digits).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email so we can send your receipt.');

    const label = payBtn.textContent;
    payBtn.disabled = true;
    payBtn.textContent = 'Processing payment...';

    try {
      const tokenResult = await squareCard.tokenize();
      if (tokenResult.status !== 'OK') {
        throw new Error(tokenResult.errors?.[0]?.message || 'Please check your card details.');
      }

      const res = await fetch(`${API_BASE}/api/special-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: ev.id,
          nonce: tokenResult.token,
          name, phone, email, notes,
          items: sel.map(i => ({ sku: i.sku, qty: i.qty })),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        showError(data.message || 'Some items just sold out. Your card was not charged. Refreshing...');
        setTimeout(() => window.location.reload(), 3500);
        return;
      }
      if (!res.ok) throw new Error(data.message || 'Payment failed. Your card was not charged.');

      // Success
      show($('sp-form'), false);
      $('sp-success-msg').textContent = `Your order is paid and confirmed. A receipt is on its way to ${email}.`;
      $('sp-success-pickup').textContent = `Pickup: ${[formatPickupDate(ev.pickupDate), ev.pickupWindow].filter(Boolean).join(', ')} at ${ev.pickupLocation || 'Castell Street Market'}.`;
      show($('sp-success'));
      $('sp-success').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      showError(err.message);
      payBtn.disabled = false;
      payBtn.textContent = label;
    }
  });
}
