/**
 * Scheduler Lambda — Sends automated preorder summary emails on:
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

export async function handler() {
  // Determine the upcoming Saturday in UTC
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat

  let saturdayDate;
  let isFriday;

  if (dayOfWeek === 6) {
    // Saturday morning send — today IS market day
    saturdayDate = now;
    isFriday = false;
  } else if (dayOfWeek === 5) {
    // Friday evening preview — tomorrow is market day
    saturdayDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    isFriday = true;
  } else {
    // Unexpected invocation day — log and exit gracefully
    console.warn(`Scheduler invoked on unexpected day (UTC day ${dayOfWeek}). Expected Friday (5) or Saturday (6). Exiting.`);
    return;
  }

  const saturdayStr = saturdayDate.toISOString().slice(0, 10); // YYYY-MM-DD

  console.log(`Running ${isFriday ? 'Friday preview' : 'Saturday morning'} scheduler for market date: ${saturdayStr}`);

  // Query all orders for this Saturday
  const orders = await queryOrdersByPickupDate(saturdayStr);
  const activeOrders = orders.filter(o => (o.status || 'NEW').toUpperCase() !== 'CANCELLED');

  console.log(`Found ${activeOrders.length} active order(s) for ${saturdayStr} (${orders.length} total including cancelled)`);

  const subject = isFriday
    ? `Friday Preview: Preorders for Saturday ${saturdayStr} (${activeOrders.length} orders)`
    : `Market Day Preorders — Saturday ${saturdayStr} (${activeOrders.length} orders)`;

  const body = buildEmailText(activeOrders, saturdayStr, isFriday);

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [OWNER_EMAIL] },
    Message: {
      Subject: { Data: subject },
      Body: { Text: { Data: body } },
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

function buildEmailText(orders, saturdayStr, isFriday) {
  const header = isFriday
    ? `Knead & Bake TX — Friday Evening Preview\nPreorders for Saturday ${saturdayStr}`
    : `Knead & Bake TX — Market Day Final List\nPreorders for Saturday ${saturdayStr}`;

  const lines = [
    header,
    `Generated: ${new Date().toISOString()}`,
    '',
    '─────────────────────────────',
    'TOTALS',
    `  Orders:           ${orders.length}`,
    `  Total Items:      ${orders.reduce((sum, o) => sum + (Array.isArray(o.items) ? o.items.reduce((s, i) => s + (i.qty || 0), 0) : 0), 0)}`,
    `  Unique Customers: ${new Set(orders.map(o => (o.phone || o.email || o.name || '').toLowerCase().trim())).size}`,
    '',
  ];

  // Product totals
  const productTotals = new Map();
  for (const order of orders) {
    for (const item of (order.items || [])) {
      if (item.name && item.qty > 0) {
        productTotals.set(item.name, (productTotals.get(item.name) || 0) + item.qty);
      }
    }
  }

  lines.push('LOAF / PRODUCT TOTALS');
  if (productTotals.size === 0) {
    lines.push('  No products ordered.');
  } else {
    [...productTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([name, qty]) => lines.push(`  ${qty}x  ${name}`));
  }

  lines.push('', '─────────────────────────────', 'ORDER DETAILS');

  if (orders.length === 0) {
    lines.push('  No preorders for this Saturday.');
  } else {
    orders
      .slice()
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      .forEach((order, idx) => {
        const items = (order.items || [])
          .filter(i => i.qty > 0)
          .map(i => `${i.qty}x ${i.name}`)
          .join(', ') || '—';

        lines.push(
          '',
          `${idx + 1}. ${order.name || 'Customer'} (${order.orderId || 'no-id'})`,
          `   Phone:   ${order.phone || '—'}`,
          `   Email:   ${order.email || 'not provided'}`,
          `   Items:   ${items}`,
          `   Notes:   ${order.notes || 'none'}`,
          `   Ordered: ${order.createdAt ? order.createdAt.replace('T', ' ').replace('.000Z', ' UTC') : '—'}`,
        );
      });
  }

  lines.push('', '─────────────────────────────');

  if (isFriday) {
    lines.push('This is your Friday evening preview. A final list will be emailed Saturday at 9 AM.');
  } else {
    lines.push('This is your final market day list. Good luck today! 🥖');
  }

  return lines.join('\n');
}
