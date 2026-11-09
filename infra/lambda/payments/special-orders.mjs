/**
 * Special market checkout — POST /api/special-orders
 *
 * Prepaid only. One call does: validate → reserve stock + write PENDING_PAYMENT order (atomic)
 * → charge card → mark PAID. If the charge fails, the order is deleted and stock restored,
 * so an unpaid customer can never hold inventory.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE = process.env.ORDERS_TABLE;
const CONFIG_TABLE = process.env.CONFIG_TABLE;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 5;

function clean(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

async function isRateLimited(ip) {
  const now = Math.floor(Date.now() / 1000);
  const key = { type: 'ORDER_RATE', id: `special:${ip}` };
  try {
    const { Item: item } = await ddb.send(new GetCommand({ TableName: CONFIG_TABLE, Key: key }));
    if (!item || now - item.windowStart > RATE_LIMIT_WINDOW_SECONDS) {
      await ddb.send(new PutCommand({
        TableName: CONFIG_TABLE,
        Item: { ...key, count: 1, windowStart: now, ttl: now + RATE_LIMIT_WINDOW_SECONDS + 60 },
      }));
      return false;
    }
    if (item.count >= RATE_LIMIT_MAX) return true;
    await ddb.send(new UpdateCommand({
      TableName: CONFIG_TABLE,
      Key: key,
      UpdateExpression: 'SET #c = #c + :one',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':one': 1 },
    }));
    return false;
  } catch (err) {
    console.error('Special order rate limit error:', err);
    return false; // fail open
  }
}

function invKey(eventId, sku) {
  return { type: 'SPECIAL_INV', id: `${eventId}#${sku}` };
}

async function releaseReservation(order) {
  const now = new Date().toISOString();
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Delete: {
          TableName: ORDERS_TABLE,
          Key: { orderId: order.orderId },
          ConditionExpression: 'paymentStatus = :pending',
          ExpressionAttributeValues: { ':pending': 'PENDING_PAYMENT' },
        },
      },
      ...order.items.map(item => ({
        Update: {
          TableName: CONFIG_TABLE,
          Key: invKey(order.specialMarketId, item.sku),
          UpdateExpression: 'SET currentQty = currentQty + :qty, updatedAt = :now',
          ExpressionAttributeValues: { ':qty': item.qty, ':now': now },
        },
      })),
    ],
  }));
}

export async function handleSpecialOrder(event, { response, chargeSquareCard, processingFeeCents, email }) {
  if (!ORDERS_TABLE || !CONFIG_TABLE) {
    return response(500, { message: 'Special orders are not configured.' });
  }

  const ip = event.requestContext?.http?.sourceIp || 'unknown';
  if (await isRateLimited(ip)) {
    return response(429, { message: 'Too many requests. Please wait a minute and try again.' });
  }

  if (event.body && event.body.length > 64 * 1024) {
    return response(413, { message: 'Request body too large.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { message: 'Invalid JSON' });
  }

  const { eventId, nonce, items } = body;
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30);
  const customerEmail = clean(body.email, 200);
  const notes = clean(body.notes || '', 500);

  if (!eventId || typeof eventId !== 'string') return response(400, { message: 'eventId is required.' });
  if (!nonce || typeof nonce !== 'string') return response(400, { message: 'Card details are required.' });
  if (name.length < 2) return response(400, { message: 'Name is required (min 2 characters).' });
  if (phone.replace(/\D/g, '').length < 10) return response(400, { message: 'A valid phone number is required (at least 10 digits).' });
  if (!email.isValidEmail(customerEmail)) return response(400, { message: 'A valid email is required so we can send your receipt.' });
  if (!Array.isArray(items) || items.length === 0) return response(400, { message: 'Select at least one item.' });

  // ── Load + validate event ──
  const { Item: ev } = await ddb.send(new GetCommand({ TableName: CONFIG_TABLE, Key: { type: 'SPECIAL_MARKET', id: eventId } }));
  if (!ev || ev.status !== 'PUBLISHED') {
    return response(404, { message: 'This special preorder is not available.' });
  }
  const nowMs = Date.now();
  if (nowMs < Date.parse(ev.opensAt)) return response(400, { message: 'Preorders for this event are not open yet.' });
  if (nowMs >= Date.parse(ev.closesAt)) return response(400, { message: 'Preorders for this event are closed.' });

  const eventItems = new Map((ev.items || []).map(i => [i.sku, i]));
  const orderItems = [];
  const seen = new Set();
  for (const raw of items) {
    const sku = clean(raw?.sku, 40);
    const qty = Math.round(Number(raw?.qty));
    const evItem = eventItems.get(sku);
    if (!evItem) return response(400, { message: 'One of the selected items is not part of this preorder.' });
    if (seen.has(sku)) continue;
    seen.add(sku);
    if (!Number.isFinite(qty) || qty < 1 || qty > Number(evItem.maxPerOrder || 10)) {
      return response(400, { message: `You can order up to ${evItem.maxPerOrder} of ${evItem.name}.` });
    }
    orderItems.push({ sku, name: evItem.name, qty, price: Number(evItem.price) });
  }

  const totalCents = Math.round(orderItems.reduce((sum, i) => sum + i.price * i.qty, 0) * 100);
  if (totalCents <= 0) return response(400, { message: 'Order has no valid total.' });
  const amountCents = totalCents + processingFeeCents;

  const orderId = randomUUID();
  const createdAt = new Date().toISOString();
  const order = {
    orderId,
    orderType: 'SPECIAL',
    specialMarketId: ev.id,
    specialMarketName: ev.name,
    pickupDate: ev.pickupDate,
    pickupWindow: ev.pickupWindow || '',
    pickupLocation: ev.pickupLocation || '',
    pickupNotes: ev.pickupNotes || '',
    name,
    email: customerEmail,
    phone,
    items: orderItems,
    notes,
    status: 'NEW',
    paymentStatus: 'PENDING_PAYMENT',
    paymentMethod: 'SQUARE',
    totalCents,
    createdAt,
  };

  // ── 1. Reserve stock + write pending order atomically ──
  try {
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: ORDERS_TABLE, Item: order } },
        ...orderItems.map(item => ({
          Update: {
            TableName: CONFIG_TABLE,
            Key: invKey(ev.id, item.sku),
            UpdateExpression: 'SET currentQty = currentQty - :qty, updatedAt = :now',
            ConditionExpression: 'currentQty >= :qty',
            ExpressionAttributeValues: { ':qty': item.qty, ':now': createdAt },
          },
        })),
      ],
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return response(409, { message: 'Some items sold out while you were ordering. Your card was not charged. Please refresh and try again.' });
    }
    console.error('Special order reserve failed:', err);
    return response(500, { message: 'Could not place your order. Your card was not charged. Please try again.' });
  }

  // ── 2. Charge card ──
  const charge = await chargeSquareCard({
    nonce,
    amountCents,
    idempotencyKey: orderId,
    note: `Knead & Bake TX - ${ev.name} #${orderId.slice(0, 8)}`,
  });

  if (!charge.ok) {
    try {
      await releaseReservation(order);
    } catch (err) {
      // Order stays PENDING_PAYMENT; admin tab flags it as stuck with a Release button
      console.error('CRITICAL: failed to release special order reservation:', { orderId, err });
    }
    return response(charge.statusCode === 500 ? 502 : 402, {
      message: `${charge.message} Your card was not charged.`,
    });
  }

  // ── 3. Mark paid ──
  const paidAt = new Date().toISOString();
  Object.assign(order, {
    paymentStatus: 'PAID',
    squarePaymentId: charge.paymentId || 'unknown',
    paidAt,
    processingFeeCents,
    totalPaidCents: amountCents,
  });
  try {
    await ddb.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET paymentStatus = :ps, squarePaymentId = :spid, paidAt = :pa, processingFeeCents = :fee, totalPaidCents = :tpc',
      ExpressionAttributeValues: {
        ':ps': 'PAID', ':spid': order.squarePaymentId, ':pa': paidAt, ':fee': processingFeeCents, ':tpc': amountCents,
      },
    }));
  } catch (err) {
    console.error('CRITICAL: special order charged but not marked paid:', { orderId, squarePaymentId: charge.paymentId, err });
  }

  try {
    await sendSpecialOrderEmails(order, email);
  } catch (err) {
    console.error('Special order email error (non-fatal):', { orderId, err });
  }

  return response(201, {
    success: true,
    orderId,
    totalCents,
    totalPaidCents: amountCents,
    pickupDate: order.pickupDate,
  });
}

// ── Emails ──

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function pickupLine(order, formatPickupDate) {
  return [formatPickupDate(order.pickupDate), order.pickupWindow].filter(Boolean).join(', ');
}

async function sendSpecialOrderEmails(order, e) {
  if (!e.SEND_EMAILS || !e.FROM_EMAIL) return;
  const short = order.orderId.slice(0, 8);
  const pickup = pickupLine(order, e.formatPickupDate);
  const location = order.pickupLocation || 'Castell Street Market, New Braunfels';
  const itemsText = order.items.map(i => `  ${i.qty}x ${i.name} ($${(i.price * i.qty).toFixed(2)})`).join('\n');
  const notesHtml = order.notes
    ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#5e4a3d;"><strong>Comments:</strong> ${e.escapeHtml(order.notes)}</p>`
    : '';
  const pickupNotesHtml = order.pickupNotes
    ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#5e4a3d;">${e.escapeHtml(order.pickupNotes)}</p>`
    : '';

  const pickupBox = `<div style="margin:0 0 20px;padding:16px;border-radius:14px;background:#fbeef0;border:2px solid #8e2b3a;">
  <p style="margin:0 0 6px;font-size:13px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#8e2b3a;">${e.escapeHtml(order.specialMarketName)} pickup</p>
  <p style="margin:0;font-size:16px;line-height:1.5;color:#3b2a1f;"><strong>${e.escapeHtml(pickup)}</strong><br>${e.escapeHtml(location)}</p>
  ${pickupNotesHtml}
</div>`;

  const totalsBox = `<div style="margin:0 0 18px;padding:16px;border-radius:14px;background:#fcf7ef;border:1px solid #efe1cd;">
  <p style="margin:0 0 10px;font-size:15px;line-height:1.6;"><strong>Subtotal:</strong> ${money(order.totalCents)}</p>
  <p style="margin:0 0 10px;font-size:15px;line-height:1.6;"><strong>Card processing fee:</strong> ${money(order.processingFeeCents)}</p>
  <p style="margin:0 0 10px;font-size:15px;line-height:1.6;"><strong>Total paid:</strong> ${money(order.totalPaidCents)}</p>
  <p style="margin:0;font-size:15px;line-height:1.6;"><strong>Square payment reference:</strong> ${e.escapeHtml(order.squarePaymentId)}</p>
</div>`;

  const tasks = [];

  if (e.isValidEmail(e.OWNER_EMAIL)) {
    tasks.push(e.ses.send(new SendEmailCommand({
      Source: e.FROM_EMAIL,
      Destination: { ToAddresses: [e.OWNER_EMAIL] },
      Message: {
        Subject: { Data: `New ${order.specialMarketName} Order (Paid): ${order.name} (#${short})` },
        Body: {
          Text: { Data:
`New special preorder (PAID)

Event: ${order.specialMarketName}
Name: ${order.name}
Phone: ${order.phone}
Email: ${order.email}
Pickup: ${pickup} at ${location}

Items:
${itemsText}

Subtotal: ${money(order.totalCents)}
Total paid: ${money(order.totalPaidCents)}
Square Payment ID: ${order.squarePaymentId}

Comments: ${order.notes || 'None'}
Order ID: ${order.orderId}` },
          Html: { Data: e.buildCustomerEmailShell({
            iconEntity: '&#9733;',
            badgeText: 'Special Market · Paid',
            heading: `New ${order.specialMarketName} Order`,
            intro: 'A customer placed and paid for a special market preorder.',
            bodyHtml: `
<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#5e4a3d;"><strong>${e.escapeHtml(order.name)}</strong> paid for order <strong>#${short}</strong>.</p>
<p style="margin:0 0 6px;font-size:15px;"><strong>Phone:</strong> ${e.escapeHtml(order.phone)}</p>
<p style="margin:0 0 16px;font-size:15px;"><strong>Email:</strong> ${e.escapeHtml(order.email)}</p>
${pickupBox}
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${e.buildItemsHtml(order.items)}</table>
${totalsBox}
${notesHtml}` }) },
        },
      },
    })));
  }

  if (e.isValidEmail(order.email) && !e.SES_SANDBOX) {
    tasks.push(e.ses.send(new SendEmailCommand({
      Source: e.FROM_EMAIL,
      Destination: { ToAddresses: [order.email] },
      Message: {
        Subject: { Data: `${order.specialMarketName} Preorder Confirmed - Knead & Bake TX (#${short})` },
        Body: {
          Text: { Data:
`Hi ${order.name},

Your ${order.specialMarketName} preorder is paid and confirmed!

${itemsText}

Subtotal: ${money(order.totalCents)}
Card processing fee: ${money(order.processingFeeCents)}
Total paid: ${money(order.totalPaidCents)}

PICKUP: ${pickup}
${location}
${order.pickupNotes ? `${order.pickupNotes}\n` : ''}${order.notes ? `\nComments: ${order.notes}\n` : ''}
Questions? Text Allyson at 425-328-4109.

Thank you!
- Knead & Bake TX

${e.buildFollowUpText()}` },
          Html: { Data: e.buildCustomerEmailShell({
            iconEntity: '&#9733;',
            badgeText: 'Paid & Confirmed',
            heading: `${order.specialMarketName} Preorder Confirmed`,
            intro: 'Your payment went through and your order is locked in.',
            bodyHtml: `
${pickupBox}
<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#5e4a3d;">Hi ${e.escapeHtml(order.name)}, thank you for your order! Here's what we're baking for you:</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${e.buildItemsHtml(order.items)}</table>
${totalsBox}
${notesHtml}
<p style="margin:0;font-size:15px;line-height:1.7;color:#5e4a3d;">Questions? Text Allyson at <a href="tel:4253284109" style="color:#8a5a44;">425-328-4109</a>.</p>
${e.buildReviewHtml()}
${e.buildSocialHtml()}` }) },
        },
      },
    })));
  }

  await Promise.all(tasks);
}
