/**
 * Tap-to-text / tap-to-email confirmation buttons for Allyson's emails.
 *
 * SYNCED COPY: this exact file lives in infra/lambda/{orders,payments,scheduler}/.
 * Edit one, copy it to the others; `npm run build` fails if they differ.
 * Regular-market wording must match src/js/text-confirmation.js (admin page).
 */

const SITE_URL = 'https://kneadandbaketx.com';
const MARKET_NAME = 'Castell Street Market';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getFirstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

// "2026-11-07" -> "Saturday, Nov 7"
export function formatShortPickupDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (!ymd || Number.isNaN(d.getTime())) return 'Saturday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// [{qty:1,name:'Plain Loaf'},{qty:2,name:'Jalapeño Cheddar'}] -> "1 Plain Loaf and 2 Jalapeño Cheddar"
export function formatItemsSentence(items = []) {
  const parts = items.filter((i) => i && i.name).map((i) => `${Number(i.qty) || 1} ${String(i.name).trim()}`);
  if (parts.length === 0) return 'your order';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function isSpecialOrder(order) {
  return String(order?.orderType || '').toUpperCase() === 'SPECIAL' || !!order?.specialMarketName;
}

export function isOrderPaid(order) {
  return String(order?.paymentStatus || (order?.paid ? 'PAID' : '')).toUpperCase() === 'PAID';
}

/**
 * Personal confirmation in Allyson's voice.
 * @param {object} order  { name, pickupDate, items, totalCents, orderType?, specialMarketName?, pickupWindow?, pickupLocation? }
 * @param {{ paid?: boolean }} opts  defaults to the order's own payment status
 */
export function buildConfirmationText(order, { paid = isOrderPaid(order) } = {}) {
  const first = getFirstName(order.name);
  const greeting = first ? `Hi ${first}!` : 'Hi there!';
  const items = formatItemsSentence(order.items);

  if (isSpecialOrder(order)) {
    const when = [formatShortPickupDate(order.pickupDate), String(order.pickupWindow || '').trim()].filter(Boolean).join(', ');
    const where = String(order.pickupLocation || '').trim();
    const eventName = String(order.specialMarketName || '').trim();
    return [
      `${greeting} It's Allyson from Knead & Bake 🍞`,
      `Thank you so much for your ${eventName ? `${eventName} ` : ''}preorder! I've got ${items} set aside for you for pickup ${when}${where ? ` at ${where}` : ''}.`,
      `${paid ? "You're all paid up, so just grab it and go." : 'See you at pickup.'} Can't wait to see you!`,
    ].join(' ');
  }

  const cents = Math.round(Number(order.totalCents) || 0);
  const totalPart = cents > 0 ? `Your total is $${(cents / 100).toFixed(2)}, and you` : 'You';
  const paymentLine = paid
    ? "You're all paid up, so just swing by before noon and grab it."
    : `${totalPart} can pay online, by Venmo, or with cash/card at pickup. Just swing by before noon.`;
  return [
    `${greeting} It's Allyson from Knead & Bake 🍞`,
    `Thank you so much for your preorder! I've got ${items} set aside for you on ${formatShortPickupDate(order.pickupDate)} at ${MARKET_NAME}.`,
    `${paymentLine} Can't wait to see you!`,
  ].join(' ');
}

function hasPhone(phone) {
  return String(phone || '').replace(/\D/g, '').length >= 10;
}

function hasEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Link to /text.html with details in the #fragment (never sent to the server);
// that page opens Messages, since email apps often block sms: links directly.
export function buildTextConfirmationUrl(order, opts) {
  if (!hasPhone(order.phone)) return '';
  const params = new URLSearchParams({
    to: order.phone,
    name: getFirstName(order.name) || order.name || '',
    body: buildConfirmationText(order, opts),
  });
  return `${SITE_URL}/text.html#${params.toString()}`;
}

// mailto: with the same note prefilled; opens Gmail/Mail on Allyson's phone.
export function buildEmailConfirmationHref(order, opts) {
  if (!hasEmail(order.email)) return '';
  const subject = isSpecialOrder(order) && order.specialMarketName
    ? `Your ${String(order.specialMarketName).trim()} preorder from Knead & Bake`
    : 'Your Knead & Bake preorder';
  const body = `${buildConfirmationText(order, opts)}\n\nAllyson\nKnead & Bake TX`;
  return `mailto:${encodeURIComponent(String(order.email).trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * "💬 Text Sarah" / "✉️ Email Sarah" buttons for an owner email.
 * size 'lg' for single-order emails, 'sm' for summary lists. Returns '' if neither is possible.
 */
export function buildContactButtonsHtml(order, { paid, size = 'lg', email = true } = {}) {
  const opts = paid === undefined ? undefined : { paid };
  const first = esc(getFirstName(order.name) || 'customer');
  const textUrl = buildTextConfirmationUrl(order, opts);
  const mailUrl = email ? buildEmailConfirmationHref(order, opts) : '';
  if (!textUrl && !mailUrl) return '';

  const pad = size === 'sm' ? '8px 14px' : '14px 24px';
  const font = size === 'sm' ? '14px' : '16px';
  const base = `display:inline-block;margin:0 6px 6px 0;padding:${pad};border-radius:999px;font-size:${font};font-weight:700;text-decoration:none;`;
  const textLabel = size === 'sm' ? `&#128172; Text ${first}` : `&#128172; Text ${first} a confirmation`;
  const mailLabel = size === 'sm' ? `&#9993;&#65039; Email ${first}` : `&#9993;&#65039; Email ${first}`;

  const buttons = [
    textUrl ? `<a href="${esc(textUrl)}" style="${base}background:#2e7d4f;color:#ffffff;border:2px solid #2e7d4f;">${textLabel}</a>` : '',
    mailUrl ? `<a href="${esc(mailUrl)}" style="${base}background:#ffffff;color:#8a5a44;border:2px solid #8a5a44;">${mailLabel}</a>` : '',
  ].filter(Boolean).join('');

  const align = size === 'sm' ? 'left' : 'center';
  const margin = size === 'sm' ? '12px 0 0' : '0 0 20px';
  return `<p style="margin:${margin};text-align:${align};">${buttons}</p>`;
}

/** Plain-text fallback lines for the email's text part. */
export function buildContactLinksText(order, opts = {}) {
  const textUrl = buildTextConfirmationUrl(order, opts);
  const mailUrl = opts.email === false ? '' : buildEmailConfirmationHref(order, opts);
  return [
    textUrl ? `Text ${getFirstName(order.name) || 'customer'}: ${textUrl}` : '',
    mailUrl ? `Email ${getFirstName(order.name) || 'customer'}: ${mailUrl}` : '',
  ].filter(Boolean).join('\n');
}
