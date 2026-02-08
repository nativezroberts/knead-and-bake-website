/**
 * Order submission Lambda — API Gateway HTTP API handler.
 * Validates input, writes to DynamoDB, optionally sends SES emails.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

const TABLE_NAME = process.env.ORDERS_TABLE;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'orders@kneadandbaketx.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@kneadandbaketx.com';
const SEND_EMAILS = process.env.SEND_EMAILS === 'true';

// Simple in-memory rate limiter (per Lambda instance)
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimiter.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
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

export async function handler(event) {
  // Rate limit by source IP
  const ip = event.requestContext?.http?.sourceIp || 'unknown';
  if (isRateLimited(ip)) {
    return response(429, { message: 'Too many requests. Please try again later.' });
  }

  // Only accept POST
  if (event.requestContext?.http?.method !== 'POST') {
    return response(405, { message: 'Method not allowed' });
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

  if (!email || !validateEmail(email)) {
    return response(400, { message: 'A valid email address is required.' });
  }

  if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return response(400, { message: 'A valid pickup date is required (YYYY-MM-DD).' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return response(400, { message: 'At least one item is required.' });
  }

  // Validate each item
  for (const item of items) {
    if (!item.sku || !item.name || typeof item.qty !== 'number' || item.qty < 1 || item.qty > 10) {
      return response(400, { message: 'Each item must have a sku, name, and qty (1-10).' });
    }
  }

  // Build order record
  const orderId = randomUUID();
  const order = {
    orderId,
    name: sanitize(name),
    email: sanitize(email),
    phone: sanitize(phone || ''),
    pickupDate: sanitize(pickupDate),
    items: items.map(i => ({
      sku: sanitize(i.sku),
      name: sanitize(i.name),
      qty: Math.min(Math.max(Math.round(i.qty), 1), 10),
    })),
    notes: sanitize(notes || ''),
    status: 'NEW',
    createdAt: new Date().toISOString(),
  };

  // Write to DynamoDB
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: order,
    }));
  } catch (err) {
    console.error('DynamoDB write error:', err);
    return response(500, { message: 'Failed to save order. Please try again.' });
  }

  // Send emails (best-effort, don't fail the order)
  if (SEND_EMAILS) {
    const itemList = order.items.map(i => `  ${i.qty}x ${i.name}`).join('\n');

    try {
      // Customer confirmation
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

Pickup: ${order.pickupDate} at the Castell Street Market, New Braunfels
${order.notes ? `Notes: ${order.notes}\n` : ''}
Payment will be collected at pickup (cash or card).

If you need to make changes, reply to this email or contact us at ${OWNER_EMAIL}.

See you Saturday!
— Knead & Bake TX`
            },
          },
        },
      }));

      // Owner notification
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [OWNER_EMAIL] },
        Message: {
          Subject: { Data: `New Preorder: ${order.name} (#${orderId.slice(0, 8)})` },
          Body: {
            Text: { Data:
`New preorder received:

Name: ${order.name}
Email: ${order.email}
Phone: ${order.phone || 'N/A'}
Pickup: ${order.pickupDate}

Items:
${itemList}

Notes: ${order.notes || 'None'}

Order ID: ${orderId}
Created: ${order.createdAt}`
            },
          },
        },
      }));
    } catch (emailErr) {
      console.error('SES email error (non-fatal):', emailErr);
    }
  }

  return response(201, {
    message: 'Order received! Check your email for confirmation.',
    orderId,
  });
}
