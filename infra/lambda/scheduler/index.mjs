/**
 * Scheduler Lambda — triggered by EventBridge on a schedule to send
 * automated preorder summary emails to the owner.
 *
 * Schedules (CDT = UTC-5, active Mar–Nov; CST = UTC-6, Nov–Mar):
 *   - Friday 7 PM CDT  → cron(0 0 ? * SAT *) = Saturday 00:00 UTC
 *   - Saturday 9 AM CDT → cron(0 14 ? * SAT *) = Saturday 14:00 UTC
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'allyson.m.roberts@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@kneadandbaketx.com';
const SEND_EMAILS = process.env.SEND_EMAILS !== 'false';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Helpers ──

function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr + 'T00:00:00').getTime());
}

function parseYmdUtc(dateStr) {
  if (!isValidDate(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function toYmdUtc(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getStartOfWeekUtc(date) {
  // Sunday-based week
  const day = date.getUTCDay();
  return addDaysUtc(date, -day);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getCustomerKey(order) {
  const nameKey = String(order.name || '').trim().toLowerCase();
  const phoneKey = normalizePhone(order.phone || '');
  const emailKey = String(order.email || '').trim().toLowerCase();
  return `${nameKey}|${phoneKey}|${emailKey}`;
}

function formatOrderCreatedAt(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return String(createdAt);
  return d.toISOString();
}

// ── Data ──

async function queryOrdersByPickupDate(pickupDate) {
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

function buildPreorderSummary(orders, weekStart, weekEnd) {
  const activeOrders = orders
    .filter(order => String(order.status || 'NEW').toUpperCase() !== 'CANCELLED')
    .map(order => {
      const items = Array.isArray(order.items)
        ? order.items
            .filter(item => item && typeof item.qty === 'number' && item.qty > 0)
            .map(item => ({
              name: sanitize(item.name || '', 200),
              qty: Math.round(item.qty),
            }))
        : [];
      const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
      return {
        orderId: sanitize(order.orderId || '', 100),
        name: sanitize(order.name || '', 200),
        phone: sanitize(order.phone || '', 50),
        email: sanitize(order.email || '', 320),
        pickupDate: sanitize(order.pickupDate || '', 20),
        notes: sanitize(order.notes || '', 500),
        status: sanitize(order.status || 'NEW', 40),
        createdAt: formatOrderCreatedAt(order.createdAt),
        items,
        totalQty,
      };
    });

  activeOrders.sort((a, b) => {
    const pickupCmp = (a.pickupDate || '').localeCompare(b.pickupDate || '');
    if (pickupCmp !== 0) return pickupCmp;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  const productTotalsMap = new Map();
  const uniqueCustomers = new Set();
  let totalQty = 0;

  for (const order of activeOrders) {
    uniqueCustomers.add(getCustomerKey(order));
    totalQty += order.totalQty;
    for (const item of order.items) {
      productTotalsMap.set(item.name, (productTotalsMap.get(item.name) || 0) + item.qty);
    }
  }

  const productTotals = Array.from(productTotalsMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  return {
    weekStart,
    weekEnd,
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

async function generateWeeklyPreorderSummary() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  const weekStartDate = getStartOfWeekUtc(todayUtc);

  const weekStart = toYmdUtc(weekStartDate);
  const weekEnd = toYmdUtc(addDaysUtc(weekStartDate, 6));
  const pickupDates = Array.from({ length: 7 }, (_, idx) => toYmdUtc(addDaysUtc(weekStartDate, idx)));

  const ordersByDay = await Promise.all(pickupDates.map(queryOrdersByPickupDate));
  return buildPreorderSummary(ordersByDay.flat(), weekStart, weekEnd);
}

function buildEmailText(summary, label) {
  const lines = [
    `Knead & Bake TX - ${label}`,
    `Week: ${summary.weekStart} to ${summary.weekEnd}`,
    `Generated: ${summary.generatedAt}`,
    '',
    'Totals',
    `- Orders: ${summary.totals.orderCount}`,
    `- Total Quantity: ${summary.totals.totalQty}`,
    `- Unique Customers: ${summary.totals.uniqueCustomers}`,
    `- Product Types Ordered: ${summary.totals.productTypeCount}`,
    '',
    'Product Totals',
  ];

  if (summary.productTotals.length === 0) {
    lines.push('- No products ordered.');
  } else {
    summary.productTotals.forEach(p => lines.push(`- ${p.name}: ${p.qty}`));
  }

  lines.push('', 'Order Details');

  if (summary.orders.length === 0) {
    lines.push('- No preorders for this week.');
  } else {
    summary.orders.forEach((order, idx) => {
      lines.push(
        '',
        `${idx + 1}. ${order.name || 'Customer'} (${order.orderId || 'No ID'})`,
        `   Pickup: ${order.pickupDate || '-'}`,
        `   Phone: ${order.phone || '-'}`,
        `   Email: ${order.email || 'Not provided'}`,
        `   Created: ${order.createdAt || '-'}`,
        `   Items: ${order.items.map(i => `${i.qty}x ${i.name}`).join(', ') || '-'}`,
        `   Notes: ${order.notes || 'None'}`,
      );
    });
  }

  return lines.join('\n');
}

// ── Handler ──

export async function handler(event) {
  if (!ORDERS_TABLE) {
    console.error('ORDERS_TABLE not configured');
    return;
  }

  if (!SEND_EMAILS) {
    console.log('Email sending disabled — skipping scheduled preorder report');
    return;
  }

  if (!FROM_EMAIL || !EMAIL_REGEX.test(OWNER_EMAIL)) {
    console.error('Email configuration invalid');
    return;
  }

  // EventBridge can pass a label in detail, otherwise derive from current UTC hour
  const label = event?.detail?.label || deriveLabel();

  try {
    const summary = await generateWeeklyPreorderSummary();

    const subject = `${label}: ${summary.weekStart} to ${summary.weekEnd} (${summary.totals.orderCount} orders)`;
    const body = buildEmailText(summary, label);

    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [OWNER_EMAIL] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } },
      },
    }));

    console.log(`Scheduled preorder report sent to ${OWNER_EMAIL} — ${summary.totals.orderCount} orders for ${summary.weekStart}–${summary.weekEnd}`);
  } catch (err) {
    console.error('Failed to send scheduled preorder report:', err);
    throw err; // re-throw so EventBridge retries and CloudWatch alarm fires
  }
}

function deriveLabel() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 6 = Saturday
  if (utcDay === 6 && utcHour < 6) return 'Friday Evening Preorder Report';
  if (utcDay === 6) return 'Saturday Morning Preorder Report';
  return 'Preorder Report';
}
