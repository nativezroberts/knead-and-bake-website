/**
 * Scheduler Lambda - Sends automated preorder emails on:
 *   - Friday at 7 PM CDT (23:00 UTC): Friday preview (owner)
 *   - Saturday at 7 AM Central: "Rise and shine" pickup reminder (each customer)
 *   - Saturday at 9 AM CDT (14:00 UTC): Saturday morning final list (owner)
 *
 * Triggered by EventBridge rules / EventBridge Scheduler (no HTTP gateway).
 * The customer reminder is invoked with { "type": "customer-reminder" }.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'allyson.m.roberts@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@kneadandbaketx.com';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || 'allyson.m.roberts@gmail.com';
const SES_SANDBOX = process.env.SES_SANDBOX === 'true';
const MARKET_TIMEZONE = 'America/Chicago';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSummaryEmailShell({ iconEntity, badgeText, heading, intro, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6efe5;font-family:Georgia,Arial,sans-serif;color:#2f241c;">
    <div style="padding:24px 12px;">
      <div style="max-width:720px;margin:0 auto;background:#fffdf9;border:1px solid #e7d7c3;border-radius:20px;overflow:hidden;">
        <div style="padding:28px 24px 20px;background:#fff6df;border-bottom:1px solid #ecdcc5;text-align:center;">
          <div style="width:68px;height:68px;line-height:68px;margin:0 auto 12px;border-radius:999px;background:#5c3d2e;color:#fff;font-size:32px;font-weight:700;">${iconEntity}</div>
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ead7ba;color:#5c3d2e;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(badgeText)}</div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.2;color:#3b2a1f;">${escapeHtml(heading)}</h1>
          <p style="margin:0;font-size:16px;line-height:1.6;color:#6e5645;">${escapeHtml(intro)}</p>
        </div>
        <div style="padding:24px;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export async function handler(event = {}) {
  if (event.type === 'customer-reminder') {
    return sendCustomerReminders();
  }

  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  let saturdayDate;
  let isFriday;

  if (dayOfWeek === 6) {
    saturdayDate = now;
    isFriday = false;
  } else if (dayOfWeek === 5) {
    saturdayDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    isFriday = true;
  } else {
    console.warn(`Scheduler invoked on unexpected day (UTC day ${dayOfWeek}). Expected Friday (5) or Saturday (6). Exiting.`);
    return;
  }

  const saturdayStr = saturdayDate.toISOString().slice(0, 10);
  console.log(`Running ${isFriday ? 'Friday preview' : 'Saturday morning'} scheduler for market date: ${saturdayStr}`);

  const orders = await queryOrdersByPickupDate(saturdayStr);
  const summary = buildDailySummary(orders, saturdayStr);

  console.log(`Found ${summary.totals.orderCount} active order(s) for ${saturdayStr} (${orders.length} total including cancelled)`);

  const subject = isFriday
    ? `Friday Preview: Preorders for Saturday ${saturdayStr} (${summary.totals.orderCount} orders)`
    : `Market Day Preorders - Saturday ${saturdayStr} (${summary.totals.orderCount} orders)`;

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [OWNER_EMAIL] },
    Message: {
      Subject: { Data: subject },
      Body: {
        Text: { Data: buildEmailText(summary, isFriday) },
        Html: { Data: buildEmailHtml(summary, isFriday) },
      },
    },
  }));

  console.log(`Email sent to ${OWNER_EMAIL} with subject: "${subject}"`);
}

async function queryOrdersByPickupDate(pickupDate) {
  if (!ORDERS_TABLE) {
    throw new Error('ORDERS_TABLE environment variable is not configured.');
  }

  let lastEvaluatedKey = undefined;
  const orders = [];

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'by-pickup-date',
      KeyConditionExpression: '#pickupDate = :pickupDate',
      ExpressionAttributeNames: { '#pickupDate': 'pickupDate' },
      ExpressionAttributeValues: { ':pickupDate': pickupDate },
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    orders.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return orders;
}

function buildDailySummary(orders, saturdayStr) {
  const activeOrders = orders
    .filter((order) => String(order.status || 'NEW').toUpperCase() !== 'CANCELLED')
    .map((order) => {
      const items = Array.isArray(order.items)
        ? order.items
            .filter((item) => item && Number(item.qty || 0) > 0)
            .map((item) => ({
              name: String(item.name || '').trim(),
              qty: Math.round(Number(item.qty || 0)),
            }))
        : [];

      const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
      const paymentStatus = String(order.paymentStatus || (order.paid ? 'PAID' : 'UNPAID')).toUpperCase();
      const paymentMethod = String(order.paymentMethod || '').toUpperCase();

      return {
        orderId: String(order.orderId || ''),
        name: String(order.name || '').trim(),
        phone: String(order.phone || '').trim(),
        email: String(order.email || '').trim(),
        pickupDate: String(order.pickupDate || saturdayStr).trim(),
        notes: String(order.notes || '').trim(),
        createdAt: String(order.createdAt || ''),
        paymentStatus,
        paymentMethod,
        items,
        totalQty,
      };
    })
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  const productTotalsMap = new Map();
  const uniqueCustomers = new Set();
  let totalQty = 0;

  activeOrders.forEach((order) => {
    uniqueCustomers.add(`${String(order.name || '').toLowerCase()}|${String(order.phone || '').toLowerCase()}|${String(order.email || '').toLowerCase()}`);
    totalQty += order.totalQty;

    order.items.forEach((item) => {
      productTotalsMap.set(item.name, (productTotalsMap.get(item.name) || 0) + item.qty);
    });
  });

  const productTotals = [...productTotalsMap.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  return {
    marketDate: saturdayStr,
    generatedAt: new Date().toISOString(),
    totals: {
      orderCount: activeOrders.length,
      totalQty,
      uniqueCustomers: uniqueCustomers.size,
      productTypeCount: productTotals.length,
    },
    productTotals,
    orders: activeOrders,
  };
}

function groupSummaryOrders(orders = []) {
  const buckets = {
    paidOnline: [],
    markedPaid: [],
    unpaidPickup: [],
  };

  orders.forEach((order) => {
    if (order.paymentStatus === 'PAID' && order.paymentMethod === 'SQUARE') {
      buckets.paidOnline.push(order);
      return;
    }

    if (order.paymentStatus === 'PAID') {
      buckets.markedPaid.push(order);
      return;
    }

    buckets.unpaidPickup.push(order);
  });

  return buckets;
}

function appendSectionText(lines, title, orders, description) {
  lines.push('', `${title} (${orders.length})`, description);

  if (!orders.length) {
    lines.push('- None');
    return;
  }

  orders.forEach((order, idx) => {
    const items = order.items.map((item) => `${item.qty}x ${item.name}`).join(', ') || '-';

    lines.push(
      '',
      `${idx + 1}. ${order.name || 'Customer'} (${order.orderId || 'no-id'})`,
      `   Pickup: ${order.pickupDate || '-'}`,
      `   Phone: ${order.phone || '-'}`,
      `   Email: ${order.email || 'not provided'}`,
      `   Ordered: ${order.createdAt || '-'}`,
      `   Items: ${items}`,
      `   Notes: ${order.notes || 'none'}`
    );
  });
}

function buildEmailText(summary, isFriday) {
  const buckets = groupSummaryOrders(summary.orders);
  const header = isFriday
    ? `Knead & Bake TX - Friday Evening Preview\nPreorders for Saturday ${summary.marketDate}`
    : `Knead & Bake TX - Market Day Final List\nPreorders for Saturday ${summary.marketDate}`;
  const lines = [
    header,
    `Generated: ${summary.generatedAt}`,
    '',
    'Totals',
    `- Orders: ${summary.totals.orderCount}`,
    `- Total Items: ${summary.totals.totalQty}`,
    `- Unique Customers: ${summary.totals.uniqueCustomers}`,
    `- Product Types Ordered: ${summary.totals.productTypeCount}`,
    '',
    'Payment Breakdown',
    `- Paid Online: ${buckets.paidOnline.length}`,
    `- Marked Paid: ${buckets.markedPaid.length}`,
    `- Payment Due at Pickup: ${buckets.unpaidPickup.length}`,
    '',
    'Loaf / Product Totals',
  ];

  if (!summary.productTotals.length) {
    lines.push('- No products ordered.');
  } else {
    summary.productTotals.forEach((product) => lines.push(`- ${product.name}: ${product.qty}`));
  }

  appendSectionText(lines, 'Paid Online', buckets.paidOnline, 'Already paid with card online.');
  appendSectionText(lines, 'Marked Paid', buckets.markedPaid, 'Recorded as paid manually.');
  appendSectionText(lines, 'Payment Due at Pickup', buckets.unpaidPickup, 'Collect payment at pickup.');

  lines.push('');
  lines.push(isFriday
    ? 'This is your Friday evening preview. A final list will be emailed Saturday morning.'
    : 'This is your final market day list. Good luck today!');

  return lines.join('\n');
}

function buildMetricCards(summary, buckets) {
  const cards = [
    { label: 'Orders', value: summary.totals.orderCount },
    { label: 'Total Loaves', value: summary.totals.totalQty },
    { label: 'Paid Online', value: buckets.paidOnline.length },
    { label: 'Due at Pickup', value: buckets.unpaidPickup.length },
  ];

  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0 0 24px;">
    ${cards.map((card) => `
      <div style="padding:16px;border:1px solid #eadbc8;border-radius:16px;background:#fcf7ef;">
        <div style="margin:0 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#8a6b57;font-weight:700;">${escapeHtml(card.label)}</div>
        <div style="font-size:28px;line-height:1.1;color:#3b2a1f;font-weight:700;">${escapeHtml(String(card.value))}</div>
      </div>
    `).join('')}
  </div>`;
}

function buildProductTotalsHtml(summary) {
  if (!summary.productTotals.length) {
    return '<p style="margin:0;font-size:15px;line-height:1.6;color:#6e5645;">No products ordered for this market date.</p>';
  }

  return `<table role="presentation" style="width:100%;border-collapse:collapse;">
    ${summary.productTotals.map((product) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0e4d5;">${escapeHtml(product.name)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0e4d5;text-align:right;font-weight:700;">${escapeHtml(String(product.qty))}</td>
      </tr>
    `).join('')}
  </table>`;
}

function buildOrderCardHtml(order) {
  return `<div style="margin:0 0 14px;padding:16px;border-radius:16px;background:#fffdf9;border:1px solid #eadbc8;">
    <p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:#3b2a1f;"><strong>${escapeHtml(order.name || 'Customer')}</strong> <span style="color:#8a6b57;">#${escapeHtml((order.orderId || '').slice(0, 8) || 'No ID')}</span></p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong>Pickup:</strong> ${escapeHtml(order.pickupDate || '-')}</p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong>Phone:</strong> ${escapeHtml(order.phone || '-')}</p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong>Email:</strong> ${escapeHtml(order.email || 'Not provided')}</p>
    <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong>Ordered:</strong> ${escapeHtml(order.createdAt || '-')}</p>
    <ul style="margin:0;padding-left:18px;color:#5e4a3d;font-size:14px;line-height:1.6;">
      ${order.items.map((item) => `<li>${escapeHtml(`${item.qty}x ${item.name}`)}</li>`).join('')}
    </ul>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong>Notes:</strong> ${escapeHtml(order.notes || 'None')}</p>
  </div>`;
}

function buildSectionHtml(title, description, orders, accentColor) {
  return `<div style="margin:0 0 24px;">
    <div style="margin:0 0 12px;padding:14px 16px;border-radius:16px;background:#fcf7ef;border-left:4px solid ${accentColor};">
      <p style="margin:0 0 4px;font-size:18px;line-height:1.4;color:#3b2a1f;font-weight:700;">${escapeHtml(title)} (${escapeHtml(String(orders.length))})</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#6e5645;">${escapeHtml(description)}</p>
    </div>
    ${orders.length
      ? orders.map((order) => buildOrderCardHtml(order)).join('')
      : '<p style="margin:0;font-size:14px;line-height:1.6;color:#6e5645;">No orders in this section.</p>'}
  </div>`;
}

function buildEmailHtml(summary, isFriday) {
  const buckets = groupSummaryOrders(summary.orders);
  const badgeText = isFriday ? 'Friday Preview' : 'Market Day List';
  const heading = isFriday
    ? `Preorders for Saturday ${summary.marketDate}`
    : `Market Day Orders for ${summary.marketDate}`;
  const intro = isFriday
    ? 'Your preview is grouped by payment status so you can see what is already covered before market day.'
    : 'Your final market day list is grouped by payment status so pickup prep is easier to scan.';

  return buildSummaryEmailShell({
    iconEntity: '&#128203;',
    badgeText,
    heading,
    intro,
    bodyHtml: `
<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#5e4a3d;">Generated at ${escapeHtml(summary.generatedAt)}.</p>
${buildMetricCards(summary, buckets)}
<div style="margin:0 0 24px;padding:18px;border-radius:18px;background:#fff8ed;border:1px solid #eadbc8;">
  <p style="margin:0 0 12px;font-size:18px;line-height:1.4;color:#3b2a1f;font-weight:700;">Loaf / Product Totals</p>
  ${buildProductTotalsHtml(summary)}
</div>
${buildSectionHtml('Paid Online', 'These orders were already paid by card online.', buckets.paidOnline, '#2e8b57')}
${buildSectionHtml('Marked Paid', 'These orders were recorded as paid manually.', buckets.markedPaid, '#8a5a44')}
${buildSectionHtml('Payment Due at Pickup', 'These orders still need payment collected at pickup.', buckets.unpaidPickup, '#c97a2b')}
<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#6e5645;">${escapeHtml(isFriday
      ? 'This is your Friday evening preview. A final list will be emailed Saturday morning.'
      : 'This is your final market day list. Good luck today!')}</p>`,
  });
}

// ── Saturday 7 AM customer pickup reminder ──

const PREORDER_URL = 'https://www.kneadandbaketx.com/preorder.html';
const DIRECTIONS_URL = 'https://www.google.com/maps/place/209+S+Castell+Ave,+New+Braunfels,+TX';
const INSTAGRAM_URL = 'https://www.instagram.com/knead_and_baketx';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61557154273182';
const VENMO_URL = 'https://venmo.com/Allyson-Roberts1';
const INACTIVE_STATUSES = new Set(['CANCELLED', 'REJECTED']);

// Today's date in market time, as YYYY-MM-DD
function getMarketDateYmd(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: MARKET_TIMEZONE });
}

// "2026-11-07" -> "Saturday, November 7"
function formatLongDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function getFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'friend';
}

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function buildReminderOrder(order) {
  const items = (Array.isArray(order.items) ? order.items : [])
    .filter((item) => item && Number(item.qty || 0) > 0)
    .map((item) => ({
      name: String(item.name || '').trim(),
      qty: Math.round(Number(item.qty || 0)),
      lineCents: Math.round(Number(item.price || 0) * Number(item.qty || 0) * 100),
    }));
  const totalCents = Number(order.totalCents) || items.reduce((sum, item) => sum + item.lineCents, 0);
  const paymentStatus = String(order.paymentStatus || (order.paid ? 'PAID' : 'UNPAID')).toUpperCase();

  return {
    orderId: String(order.orderId || ''),
    firstName: getFirstName(order.name),
    email: String(order.email || '').trim(),
    pickupDate: String(order.pickupDate || ''),
    items,
    itemCount: items.reduce((sum, item) => sum + item.qty, 0),
    totalCents,
    isPaid: paymentStatus === 'PAID',
  };
}

function buildReminderSubject(r) {
  return `Rise and shine, ${r.firstName} ☀️ Your sourdough is waiting`;
}

function buildReminderPreheader(r) {
  const what = r.itemCount === 1 ? 'Your loaf is' : `Your ${r.itemCount} items are`;
  return `${what} bagged and waiting at Castell Street Market. Pick up by noon!`;
}

function buildReminderEmailHtml(r) {
  const itemRows = r.items.map((item) => `
            <tr><td style="padding:10px 0;border-bottom:1px solid #f0e4d5;">${escapeHtml(`${item.qty}× ${item.name}`)}</td><td style="padding:10px 0;border-bottom:1px solid #f0e4d5;text-align:right;font-weight:700;">${escapeHtml(formatMoney(item.lineCents))}</td></tr>`).join('');
  const paymentHtml = r.isPaid
    ? '<strong>Paid &#10003;</strong> Nothing to pay at pickup. Just grab your bread!'
    : `<strong>Pay at pickup:</strong> cash, card, or Venmo <a href="${VENMO_URL}" style="color:#8a5a44;">@Allyson-Roberts1</a>`;
  const socialBtn = 'display:inline-block;margin:4px;padding:10px 20px;border-radius:999px;border:2px solid #5c3d2e;color:#5c3d2e;text-decoration:none;font-size:14px;font-weight:700;';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>It's Bread Day!</title></head>
<body style="margin:0;padding:0;background:#f6efe5;font-family:Arial,Helvetica,sans-serif;color:#2f241c;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(buildReminderPreheader(r))}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6efe5;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf9;border:1px solid #e7d7c3;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:32px 28px 8px;text-align:center;background:#fff6df;border-bottom:1px solid #ecdcc5;">
          <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:#5c3d2e;color:#fdf6ec;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Today is pickup day</div>
          <h1 style="margin:16px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.15;color:#3b2a1f;">It&#8217;s Bread Day, ${escapeHtml(r.firstName)}! &#127838;</h1>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#6e5645;">Your sourdough came out of the oven this morning, and it has your name on it.</p>
        </td></tr>

        <tr><td style="padding:20px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff3cd;border:2px solid #e8a020;border-radius:16px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7a4a00;">&#9888;&#65039; Please pick up before noon</p>
              <p style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#3b2a1f;">Today by 12:00 PM</p>
              <p style="margin:0 0 4px;font-size:15px;line-height:1.5;color:#3b2a1f;"><strong>${escapeHtml(formatLongDate(r.pickupDate))}</strong> &middot; Market open 9 AM &ndash; 1 PM</p>
              <p style="margin:0 0 4px;font-size:15px;line-height:1.5;color:#3b2a1f;">Castell Street Market, 209 S Castell Ave, New Braunfels</p>
              <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#5e4a3d;">Look for the <strong>green tent</strong> with the Knead &amp; Bake sign.</p>
              <a href="${DIRECTIONS_URL}" style="display:inline-block;padding:10px 20px;background:#5c3d2e;color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px;font-weight:700;">&#128205; Get directions</a>
              <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#5e4a3d;">Orders not picked up by noon are released for walk-up sale. Running late? Text Allyson at <a href="tel:4253284109" style="color:#8a5a44;">425-328-4109</a>.</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 28px 4px;">
          <p style="margin:0 0 10px;font-family:Georgia,serif;font-size:19px;font-weight:bold;color:#3b2a1f;">Your order <span style="font-family:Arial,sans-serif;font-size:13px;font-weight:normal;color:#a08878;">#${escapeHtml(r.orderId.slice(0, 8))}</span></p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;">${itemRows}
            <tr><td style="padding:12px 0 0;font-weight:700;">Total</td><td style="padding:12px 0 0;text-align:right;font-weight:700;">${escapeHtml(formatMoney(r.totalCents))}</td></tr>
          </table>
          <p style="margin:12px 0 0;padding:10px 14px;border-radius:10px;background:#fcf7ef;font-size:14px;line-height:1.5;color:#5e4a3d;">${paymentHtml}</p>
        </td></tr>

        <tr><td style="padding:24px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid #e8c872;">
            <tr><td style="padding:4px 0 4px 16px;">
              <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:17px;font-style:italic;line-height:1.55;color:#3b2a1f;">&#8220;Thank you so much for your order! Every loaf is mixed, shaped, and baked by hand in our New Braunfels kitchen. We hope it makes your weekend a little more delicious.&#8221;</p>
              <p style="margin:0;font-size:14px;font-weight:700;color:#5c3d2e;">&mdash; Allyson &amp; family</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaf1e8;border:2px solid #5a7b56;border-radius:16px;">
            <tr><td style="padding:20px;text-align:center;">
              <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:21px;font-weight:bold;color:#2f4a2c;">Need one more loaf? It&#8217;s not too late!</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3d5a3a;">Preorders stay open until <strong>9:00 AM today</strong>. Grab one for a neighbor, a sandwich loaf for the week, or an extra to freeze. We&#8217;ll have it ready at the booth.</p>
              <a href="${PREORDER_URL}" style="display:inline-block;padding:14px 32px;background:#5a7b56;color:#ffffff;text-decoration:none;border-radius:999px;font-size:15px;font-weight:700;">Add another loaf before 9 AM &rarr;</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 28px 4px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#5e4a3d;"><strong style="color:#3b2a1f;">&#129348; Baker&#8217;s tip:</strong> Store your loaf cut-side down on a board for the first day or two. Want it to last longer? Slice and freeze, then toast straight from the freezer.</p>
        </td></tr>

        <tr><td style="padding:24px 28px 28px;text-align:center;">
          <p style="margin:0 0 6px;font-size:16px;font-weight:bold;color:#3b2a1f;">Slicing in? Show us! &#128248;</p>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#6e5645;">Tag <strong>@knead_and_baketx</strong> and follow along for weekly bakes, new flavors, and market updates.</p>
          <a href="${INSTAGRAM_URL}" style="${socialBtn}">&#128248; Instagram</a>
          <a href="${FACEBOOK_URL}" style="${socialBtn}">&#128077; Facebook</a>
        </td></tr>

        <tr><td style="padding:16px 28px 22px;background:#f5f0e8;border-top:1px solid #e7d7c3;text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#6e5645;">Questions? Just reply to this email and it goes straight to Allyson.</p>
          <p style="margin:0;font-size:12px;color:#a08878;">Knead &amp; Bake TX &middot; Small-batch sourdough from New Braunfels, Texas</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildReminderEmailText(r) {
  const items = r.items.map((item) => `  ${item.qty}x ${item.name} (${formatMoney(item.lineCents)})`).join('\n');
  return `It's Bread Day, ${r.firstName}! 🍞

Your sourdough came out of the oven this morning, and it has your name on it.

⚠️ PLEASE PICK UP BEFORE NOON (12:00 PM) TODAY
${formatLongDate(r.pickupDate)} · Market open 9 AM – 1 PM
Castell Street Market, 209 S Castell Ave, New Braunfels
Look for the green tent with the Knead & Bake sign.
Directions: ${DIRECTIONS_URL}
Orders not picked up by noon are released for walk-up sale. Running late? Text Allyson at 425-328-4109.

YOUR ORDER #${r.orderId.slice(0, 8)}
${items}
Total: ${formatMoney(r.totalCents)}
${r.isPaid ? 'Paid. Nothing to pay at pickup.' : 'Pay at pickup: cash, card, or Venmo @Allyson-Roberts1'}

"Thank you so much for your order! Every loaf is mixed, shaped, and baked by hand in our New Braunfels kitchen. We hope it makes your weekend a little more delicious."
- Allyson & family

NEED ONE MORE LOAF? It's not too late! Preorders stay open until 9:00 AM today. We'll have it ready at the booth.
${PREORDER_URL}

Slicing in? Tag @knead_and_baketx and follow along:
- Instagram: ${INSTAGRAM_URL}
- Facebook: ${FACEBOOK_URL}

Questions? Just reply to this email and it goes straight to Allyson.`;
}

// Claim the order for a reminder so retries never double-send. Returns false if already claimed.
async function claimReminder(orderId, now) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET reminderSentAt = :now',
      ConditionExpression: 'attribute_exists(orderId) AND attribute_not_exists(reminderSentAt)',
      ExpressionAttributeValues: { ':now': now },
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function releaseReminder(orderId) {
  await ddb.send(new UpdateCommand({
    TableName: ORDERS_TABLE,
    Key: { orderId },
    UpdateExpression: 'REMOVE reminderSentAt',
  }));
}

async function sendCustomerReminders() {
  const marketDate = getMarketDateYmd();
  const orders = await queryOrdersByPickupDate(marketDate);
  const eligible = orders
    .filter((order) => !INACTIVE_STATUSES.has(String(order.status || 'NEW').toUpperCase()))
    .map(buildReminderOrder)
    .filter((r) => r.orderId && r.items.length && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));

  console.log(`Customer reminders for ${marketDate}: ${eligible.length} eligible of ${orders.length} order(s)`);

  if (SES_SANDBOX) {
    console.warn('SES sandbox mode: skipping customer reminder emails.');
    return { marketDate, sent: 0, skipped: eligible.length, failed: 0 };
  }

  const now = new Date().toISOString();
  let sent = 0;
  let skipped = 0;
  const failed = [];

  for (const r of eligible) {
    if (!(await claimReminder(r.orderId, now))) {
      skipped++;
      continue;
    }
    try {
      await ses.send(new SendEmailCommand({
        Source: `"Knead & Bake TX" <${FROM_EMAIL}>`,
        Destination: { ToAddresses: [r.email] },
        ReplyToAddresses: [REPLY_TO_EMAIL],
        Message: {
          Subject: { Data: buildReminderSubject(r), Charset: 'UTF-8' },
          Body: {
            Text: { Data: buildReminderEmailText(r), Charset: 'UTF-8' },
            Html: { Data: buildReminderEmailHtml(r), Charset: 'UTF-8' },
          },
        },
      }));
      sent++;
    } catch (err) {
      console.error(`Reminder email failed for order ${r.orderId}:`, err);
      failed.push(r.orderId.slice(0, 8));
      await releaseReminder(r.orderId).catch((e) => console.error('Failed to release reminder claim:', e));
    }
  }

  console.log(`Customer reminders for ${marketDate}: sent=${sent} skipped=${skipped} failed=${failed.length}`);

  if (eligible.length) {
    const failedLine = failed.length ? ` ${failed.length} failed: #${failed.join(', #')}.` : '';
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [OWNER_EMAIL] },
      Message: {
        Subject: { Data: `Pickup reminders sent: ${sent} customer${sent === 1 ? '' : 's'} (${marketDate})` },
        Body: {
          Text: { Data: `Sent ${sent} "Rise and shine" pickup reminder${sent === 1 ? '' : 's'} for ${formatLongDate(marketDate)}.${skipped ? ` ${skipped} already had one.` : ''}${failedLine}` },
        },
      },
    })).catch((err) => console.error('Owner reminder summary email failed:', err));
  }

  return { marketDate, sent, skipped, failed: failed.length };
}
