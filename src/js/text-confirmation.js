/**
 * Tap-to-text order confirmations.
 * Builds a personal confirmation message in Allyson's voice and an sms: link
 * that opens Messages on her phone with the customer's number and text filled in.
 * Keep the message wording in sync with buildConfirmationText() in
 * infra/lambda/orders/index.mjs (used for the new-preorder owner email).
 */

const MARKET_NAME = 'Castell Street Market';

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
  const parts = items
    .filter((i) => i && i.name)
    .map((i) => `${Number(i.qty) || 1} ${String(i.name).trim()}`);
  if (parts.length === 0) return 'your order';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * @param {object} order  { name, pickupDate, items, totalCents }
 * @param {{ paid?: boolean }} opts  paid=true when payment is already collected
 */
export function buildConfirmationText(order, { paid = false } = {}) {
  const first = getFirstName(order.name);
  const greeting = first ? `Hi ${first}!` : 'Hi there!';
  const cents = Math.round(Number(order.totalCents) || 0);
  const totalPart = cents > 0 ? `Your total is $${(cents / 100).toFixed(2)}, and you` : 'You';
  const paymentLine = paid
    ? "You're all paid up, so just swing by before noon and grab it."
    : `${totalPart} can pay online, by Venmo, or with cash/card at pickup. Just swing by before noon.`;

  return [
    `${greeting} It's Allyson from Knead & Bake 🍞`,
    `Thank you so much for your preorder! I've got ${formatItemsSentence(order.items)} set aside for you on ${formatShortPickupDate(order.pickupDate)} at ${MARKET_NAME}.`,
    `${paymentLine} Can't wait to see you!`,
  ].join(' ');
}

// "(512) 555-1234" -> "+15125551234"; returns '' if it can't be a phone number.
export function normalizeUsPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return '';
}

// "?&body=" works in Messages on both iOS and Android.
export function buildSmsHref(phone, body) {
  const to = normalizeUsPhone(phone);
  if (!to) return '';
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}
