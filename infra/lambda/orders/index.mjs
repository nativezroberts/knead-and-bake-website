/**
 * Order submission Lambda — API Gateway HTTP API handler.
 * Validates input, deducts inventory atomically, writes to DynamoDB, sends SES emails.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

// Load menu.json for authoritative prices (bundled alongside handler)
const __dirname = dirname(fileURLToPath(import.meta.url));
const menuData = JSON.parse(readFileSync(join(__dirname, 'menu.json'), 'utf-8'));
const PRICE_MAP = Object.fromEntries(menuData.items.map(i => [i.sku, i.price]));

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const CONFIG_TABLE = process.env.CONFIG_TABLE;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'allyson.m.roberts@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@kneadandbaketx.com';
const SEND_EMAILS = process.env.SEND_EMAILS === 'true';
const SES_SANDBOX = process.env.SES_SANDBOX === 'true';

// Preorder cutoff constants (must match market-dates.js)
const MARKET_TIMEZONE = 'America/Chicago';
const CUTOFF_HOUR = 9; // 9 AM CST on market day (Saturday)

// DynamoDB-backed rate limiter — persistent across Lambda instances and cold starts
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 5;

async function isRateLimited(ip) {
  if (!CONFIG_TABLE) return false;
  const now = Math.floor(Date.now() / 1000);
  const key = { type: 'ORDER_RATE', id: ip };

  try {
    const result = await ddb.send(new GetCommand({ TableName: CONFIG_TABLE, Key: key }));
    const item = result.Item;

    if (!item || now - item.windowStart > RATE_LIMIT_WINDOW_SECONDS) {
      // New or expired window — start fresh at count 1
      await ddb.send(new PutCommand({
        TableName: CONFIG_TABLE,
        Item: {
          type: 'ORDER_RATE',
          id: ip,
          count: 1,
          windowStart: now,
          ttl: now + RATE_LIMIT_WINDOW_SECONDS + 60,
        },
      }));
      return false;
    }

    if (item.count >= RATE_LIMIT_MAX) return true;

    // Increment within current window
    await ddb.send(new UpdateCommand({
      TableName: CONFIG_TABLE,
      Key: key,
      UpdateExpression: 'SET #c = #c + :one',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':one': 1 },
    }));
    return false;
  } catch (e) {
    console.error('Rate limit error:', e);
    return false; // Fail open — never block a legitimate order due to infra error
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 500);
}

function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}

function getCSTDate(date = new Date()) {
  const str = date.toLocaleString('en-US', { timeZone: MARKET_TIMEZONE });
  return new Date(str);
}

function isSaturday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 6;
}

/**
 * Check if preorders are still open for the given Saturday pickup date.
 * Cutoff is CUTOFF_HOUR (9 AM) CST on the market day (Saturday).
 */
function isPreorderOpen(pickupDateStr) {
  const cutoff = new Date(pickupDateStr + 'T12:00:00');
  cutoff.setHours(CUTOFF_HOUR, 0, 0, 0);
  const now = getCSTDate();
  return now < cutoff;
}

/**
 * Fetch skip dates from DynamoDB and check if the given date is skipped.
 */
async function isSkippedDate(pickupDateStr) {
  if (!CONFIG_TABLE) return false;
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { type: 'SKIP_DATE', id: pickupDateStr },
  }));
  return !!result.Item;
}

export async function handler(event) {
  // Rate limit by source IP
  const ip = event.requestContext?.http?.sourceIp || 'unknown';
  if (await isRateLimited(ip)) {
    return response(429, { message: 'Too many requests. Please try again later.' });
  }

  // Only accept POST
  if (event.requestContext?.http?.method !== 'POST') {
    return response(405, { message: 'Method not allowed' });
  }

  if (event.body && event.body.length > 5 * 1024 * 1024) {
    return response(413, { message: 'Request body too large.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { message: 'Invalid JSON' });
  }

  // Validate required fields
  const { name, email, phone, pickupDate, items, notes } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return response(400, { message: 'Name is required (min 2 characters).' });
  }

  if (!validatePhone(phone)) {
    return response(400, { message: 'A valid phone number is required (at least 10 digits).' });
  }

  // Email is optional, but validate format if provided
  if (email && !validateEmail(email)) {
    return response(400, { message: 'Please enter a valid email address or leave it blank.' });
  }

  if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return response(400, { message: 'A valid pickup date is required (YYYY-MM-DD).' });
  }

  // Server-side preorder business rules
  if (!isSaturday(pickupDate)) {
    return response(400, { message: 'Pickup date must be a Saturday market day.' });
  }

  if (!isPreorderOpen(pickupDate)) {
    return response(400, { message: 'Preorders for this market date are closed.' });
  }

  if (await isSkippedDate(pickupDate)) {
    return response(400, { message: 'No market is scheduled for this date.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return response(400, { message: 'At least one item is required.' });
  }

  // Validate each item
  for (const item of items) {
    if (!item.sku || !item.name || typeof item.qty !== 'number' || item.qty < 1 || item.qty > 99) {
      return response(400, { message: 'Each item must have a sku, name, and qty (1-99).' });
    }
  }

  // Check inventory availability for each item
  if (CONFIG_TABLE) {
    for (const item of items) {
      const result = await ddb.send(new GetCommand({
        TableName: CONFIG_TABLE,
        Key: { type: 'PRODUCT_INVENTORY', id: item.sku },
      }));

      const inv = result.Item;
      if (!inv || !inv.available) {
        return response(400, {
          message: `${item.name} is not available for preorder.`,
          unavailableItems: [item.sku],
        });
      }

      if (inv.currentQty < item.qty) {
        return response(400, {
          message: inv.currentQty === 0
            ? `${item.name} is sold out for this week.`
            : `Only ${inv.currentQty} of ${item.name} available. Please reduce quantity.`,
          unavailableItems: [item.sku],
          available: inv.currentQty,
        });
      }
    }
  }

  // Build order record with server-side prices from menu.json
  const orderId = randomUUID();
  const orderItems = items.map(i => {
    const sku = sanitize(i.sku);
    const price = PRICE_MAP[sku];
    if (price == null) {
      // Should not happen if frontend and menu.json are in sync
      console.error(`Unknown SKU price: ${sku}`);
    }
    return {
      sku,
      name: sanitize(i.name),
      qty: Math.min(Math.max(Math.round(i.qty), 1), 99),
      price: price ?? 0,
    };
  });
  const totalCents = Math.round(orderItems.reduce((sum, i) => sum + i.price * i.qty, 0) * 100);

  const order = {
    orderId,
    name: sanitize(name),
    email: sanitize(email || ''),
    phone: sanitize(phone),
    pickupDate: sanitize(pickupDate),
    items: orderItems,
    notes: sanitize(notes || ''),
    status: 'NEW',
    paymentStatus: 'UNPAID',
    totalCents,
    createdAt: new Date().toISOString(),
  };

  // Atomically write order + deduct inventory using DynamoDB transaction
  try {
    const transactItems = [
      {
        Put: {
          TableName: ORDERS_TABLE,
          Item: order,
        },
      },
    ];

    // Add inventory decrements if config table is available
    if (CONFIG_TABLE) {
      const now = new Date().toISOString();
      for (const item of order.items) {
        transactItems.push({
          Update: {
            TableName: CONFIG_TABLE,
            Key: { type: 'PRODUCT_INVENTORY', id: item.sku },
            UpdateExpression: 'SET currentQty = currentQty - :qty, updatedAt = :now',
            ConditionExpression: 'currentQty >= :qty AND available = :t',
            ExpressionAttributeValues: {
              ':qty': item.qty,
              ':now': now,
              ':t': true,
            },
          },
        });
      }
    }

    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      console.error('Transaction canceled (inventory conflict):', err);
      return response(409, {
        message: 'Some items may have sold out while you were ordering. Please refresh the page and try again.',
      });
    }
    console.error('DynamoDB write error:', err);
    return response(500, { message: 'Failed to save order. Please try again.' });
  }

  // Send emails (best-effort, don't fail the order)
  if (SEND_EMAILS) {
    const itemList = order.items.map(i => `  ${i.qty}x ${i.name} ($${(i.price * i.qty).toFixed(2)})`).join('\n');
    const totalStr = `$${(order.totalCents / 100).toFixed(2)}`;

    try {
      // Owner notification (always send — works in SES sandbox since owner email is verified)
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [OWNER_EMAIL] },
        Message: {
          Subject: { Data: `New Preorder: ${order.name} (#${orderId.slice(0, 8)})` },
          Body: {
            Text: { Data:
`New preorder received:

Name: ${order.name}
Phone: ${order.phone}
Email: ${order.email || 'Not provided'}
Pickup: ${order.pickupDate}

Items:
${itemList}

Total: ${totalStr}
Payment: Pending (customer will pay online or at pickup)

Comments: ${order.notes || 'None'}

Order ID: ${orderId}
Created: ${order.createdAt}`
            },
          },
        },
      }));

      // Customer confirmation (only if email provided and NOT in SES sandbox mode)
      if (order.email && !SES_SANDBOX) {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [order.email] },
          Message: {
            Subject: { Data: `Order Confirmation — Knead & Bake TX (#${orderId.slice(0, 8)})` },
            Body: {
              Text: { Data:
`Hi ${order.name},

Thanks for your preorder! Here's what we have for you:

${itemList}

Total: ${totalStr}

Pickup: ${order.pickupDate} at the New Braunfels Farmers Market
${order.notes ? `Comments: ${order.notes}\n` : ''}
Payment Options:
- Pay online with card (a $0.30 processing fee applies)
- Pre-pay via Venmo: @Allyson-Roberts1 (https://venmo.com/Allyson-Roberts1)
- Or pay at pickup (cash or card)

We'll text you at ${order.phone} to confirm closer to pickup day.

See you Saturday!
— Knead & Bake TX`
              },
            },
          },
        }));
      }
    } catch (emailErr) {
      console.error('SES email error (non-fatal):', emailErr);
    }
  }

  return response(201, {
    message: 'Order received! We\'ll text you to confirm.',
    orderId,
    totalCents: order.totalCents,
  });
}
