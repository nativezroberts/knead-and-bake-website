/**
 * Scheduler Lambda - Sends automated preorder summary emails on:
 *   - Friday at 7 PM CDT (23:00 UTC): Friday preview
 *   - Saturday at 9 AM CDT (14:00 UTC): Saturday morning final list
 *
 * Triggered by EventBridge scheduled rules (no HTTP gateway).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'allyson.m.roberts@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@kneadandbaketx.com';

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

export async function handler() {
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
