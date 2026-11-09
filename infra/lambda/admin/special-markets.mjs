/**
 * Special Markets — one-off preorder events (e.g. Thanksgiving) separate from the
 * weekly Saturday market. Each event has its own pickup date, order window, and
 * per-item stock. Orders are prepaid by card (see payments/special-orders.mjs).
 *
 * Storage (knead-bake-market-config table):
 *   type=SPECIAL_MARKET  id=<eventId>          event config + item list (name/price snapshot)
 *   type=SPECIAL_INV     id=<eventId>#<sku>    { totalQty, currentQty } — never touched by weekly reset
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.CONFIG_TABLE;
const ORDERS_TABLE = process.env.ORDERS_TABLE;
const MARKET_TIMEZONE = 'America/Chicago';
const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QTY = 999;
const DEFAULT_MAX_PER_ORDER = 10;

// ── Time helpers (admin enters Central Time; we store UTC ISO + the local string) ──

function chicagoOffsetMinutes(date) {
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TIMEZONE, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find(p => p.type === 'timeZoneName')?.value || '';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(tz);
  if (!m) return -360;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** "2026-11-21T23:59" (Central) -> epoch ms */
export function centralLocalToUtcMs(local) {
  const asUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asUtc)) return NaN;
  const off = chicagoOffsetMinutes(new Date(asUtc));
  let utc = asUtc - off * 60000;
  const off2 = chicagoOffsetMinutes(new Date(utc));
  if (off2 !== off) utc = asUtc - off2 * 60000; // DST boundary correction
  return utc;
}

function clean(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function queryByType(type) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':type': type },
      ExclusiveStartKey,
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function getItem(type, id) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { type, id } }));
  return result.Item || null;
}

async function getInventoryForEvent(eventId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: '#type = :type AND begins_with(#id, :prefix)',
    ExpressionAttributeNames: { '#type': 'type', '#id': 'id' },
    ExpressionAttributeValues: { ':type': 'SPECIAL_INV', ':prefix': `${eventId}#` },
  }));
  return new Map((result.Items || []).map(i => [i.sku, i]));
}

function groupInventory(invItems) {
  const byEvent = new Map();
  for (const inv of invItems) {
    if (!byEvent.has(inv.eventId)) byEvent.set(inv.eventId, new Map());
    byEvent.get(inv.eventId).set(inv.sku, inv);
  }
  return byEvent;
}

/**
 * draft | archived | scheduled (published, not yet announced) | announced (visible, not open)
 * | open | soldout | closed
 */
export function computeState(ev, invMap, now = Date.now()) {
  if (ev.status === 'ARCHIVED') return 'archived';
  if (ev.status !== 'PUBLISHED') return 'draft';
  const opens = Date.parse(ev.opensAt);
  const closes = Date.parse(ev.closesAt);
  if (now >= closes) return 'closed';
  if (now < opens) {
    const announce = ev.announceAt ? Date.parse(ev.announceAt) : NaN;
    return !Number.isNaN(announce) && now < announce ? 'scheduled' : 'announced';
  }
  const items = ev.items || [];
  const anyLeft = items.some(i => Number(invMap?.get(i.sku)?.currentQty || 0) > 0);
  return anyLeft ? 'open' : 'soldout';
}

function withInventory(ev, invMap) {
  return {
    ...ev,
    items: (ev.items || []).map(i => {
      const inv = invMap?.get(i.sku);
      const totalQty = Number(inv?.totalQty || 0);
      const currentQty = Math.max(0, Number(inv?.currentQty || 0));
      return { ...i, totalQty, currentQty, sold: Math.max(0, totalQty - currentQty) };
    }),
  };
}

function toPublicEvent(ev, invMap, state) {
  const full = withInventory(ev, invMap);
  return {
    id: full.id,
    name: full.name,
    tagline: full.tagline || '',
    description: full.description || '',
    buttonLabel: full.buttonLabel || full.name,
    opensAt: full.opensAt,
    closesAt: full.closesAt,
    pickupDate: full.pickupDate,
    pickupWindow: full.pickupWindow || '',
    pickupLocation: full.pickupLocation || '',
    pickupNotes: full.pickupNotes || '',
    state,
    items: full.items.map(i => ({
      sku: i.sku,
      name: i.name,
      price: i.price,
      maxPerOrder: i.maxPerOrder,
      currentQty: i.currentQty,
    })),
  };
}

// ── Public reads ──

/** Summary list for GET /api/market-config (drives the SPECIAL MARKET button site-wide). */
export async function getPublicSpecialMarketSummaries() {
  const [events, invItems] = await Promise.all([queryByType('SPECIAL_MARKET'), queryByType('SPECIAL_INV')]);
  const invByEvent = groupInventory(invItems);
  const now = Date.now();
  return events
    .map(ev => ({ ev, state: computeState(ev, invByEvent.get(ev.id), now) }))
    .filter(({ state }) => state === 'announced' || state === 'open' || state === 'soldout')
    .sort((a, b) => Date.parse(a.ev.closesAt) - Date.parse(b.ev.closesAt))
    .map(({ ev, state }) => ({
      id: ev.id,
      name: ev.name,
      buttonLabel: ev.buttonLabel || ev.name,
      opensAt: ev.opensAt,
      closesAt: ev.closesAt,
      pickupDate: ev.pickupDate,
      state,
    }));
}

/** GET /api/special-markets/{id} — published events only. */
export async function getPublicSpecialMarket(id, response) {
  const ev = id ? await getItem('SPECIAL_MARKET', id) : null;
  if (!ev || ev.status !== 'PUBLISHED') {
    return response(404, { message: 'This special preorder is not available.' });
  }
  const invMap = await getInventoryForEvent(id);
  const state = computeState(ev, invMap);
  if (state === 'scheduled') {
    return response(404, { message: 'This special preorder is not available yet.' });
  }
  return response(200, { _nocache: true, specialMarket: toPublicEvent(ev, invMap, state), serverTime: new Date().toISOString() });
}

// ── Admin CRUD ──

export async function listSpecialMarkets(response) {
  const [events, invItems] = await Promise.all([queryByType('SPECIAL_MARKET'), queryByType('SPECIAL_INV')]);
  const invByEvent = groupInventory(invItems);
  const now = Date.now();
  const specialMarkets = events
    .map(ev => {
      const invMap = invByEvent.get(ev.id);
      return { ...withInventory(ev, invMap), state: computeState(ev, invMap, now) };
    })
    .sort((a, b) => (b.pickupDate || '').localeCompare(a.pickupDate || ''));
  return response(200, { _nocache: true, specialMarkets });
}

function validateEventBody(body, { requireItemsForPublish }) {
  const name = clean(body.name, 80);
  if (name.length < 3) return { error: 'Event name is required (at least 3 characters).' };

  const pickupDate = clean(body.pickupDate, 10);
  if (!YMD_RE.test(pickupDate)) return { error: 'Pickup date is required.' };

  const opensAtLocal = clean(body.opensAtLocal, 16);
  const closesAtLocal = clean(body.closesAtLocal, 16);
  if (!LOCAL_DT_RE.test(opensAtLocal)) return { error: 'Preorders open date/time is required.' };
  if (!LOCAL_DT_RE.test(closesAtLocal)) return { error: 'Preorders close date/time is required.' };

  const announceAtLocal = clean(body.announceAtLocal || '', 16);
  if (announceAtLocal && !LOCAL_DT_RE.test(announceAtLocal)) return { error: 'Announce date/time is invalid.' };

  const opensMs = centralLocalToUtcMs(opensAtLocal);
  // Close is inclusive of the chosen minute: 11:59 PM means orders accepted through 11:59:59 PM.
  const closesMs = centralLocalToUtcMs(closesAtLocal) + 59_999;
  const announceMs = announceAtLocal ? centralLocalToUtcMs(announceAtLocal) : NaN;

  if (!(opensMs < closesMs)) return { error: 'Preorders must open before they close.' };
  if (announceAtLocal && announceMs > opensMs) return { error: 'Announce time must be on or before the open time.' };
  if (closesAtLocal.slice(0, 10) > pickupDate) return { error: 'Preorders must close on or before the pickup date.' };

  const status = STATUSES.has(body.status) ? body.status : 'DRAFT';

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const sku = clean(raw?.sku, 40);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const qty = Math.round(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) {
      return { error: `Quantity for ${sku} must be between 0 and ${MAX_QTY}.` };
    }
    let maxPerOrder = Math.round(Number(raw.maxPerOrder || DEFAULT_MAX_PER_ORDER));
    if (!Number.isFinite(maxPerOrder) || maxPerOrder < 1) maxPerOrder = DEFAULT_MAX_PER_ORDER;
    items.push({ sku, qty, maxPerOrder: Math.min(maxPerOrder, 99) });
  }

  if (requireItemsForPublish && status === 'PUBLISHED' && !items.some(i => i.qty > 0)) {
    return { error: 'Add at least one item with a quantity before publishing.' };
  }

  return {
    value: {
      name,
      tagline: clean(body.tagline || '', 140),
      description: clean(body.description || '', 2000),
      buttonLabel: clean(body.buttonLabel || '', 40) || name,
      pickupDate,
      pickupWindow: clean(body.pickupWindow || '', 60),
      pickupLocation: clean(body.pickupLocation || '', 120),
      pickupNotes: clean(body.pickupNotes || '', 500),
      opensAtLocal,
      closesAtLocal,
      announceAtLocal,
      opensAt: new Date(opensMs).toISOString(),
      closesAt: new Date(closesMs).toISOString(),
      announceAt: announceAtLocal ? new Date(announceMs).toISOString() : '',
      status,
      items,
    },
  };
}

/** POST (id=null) or PUT /api/admin/special-markets/{id}. Saves event + reconciles per-item stock atomically. */
export async function saveSpecialMarket(id, body, { response, writeAuditLog }) {
  const { value, error } = validateEventBody(body || {}, { requireItemsForPublish: true });
  if (error) return response(400, { message: error });

  let existing = null;
  let eventId = id;
  if (eventId) {
    existing = await getItem('SPECIAL_MARKET', eventId);
    if (!existing) return response(404, { message: 'Special market not found.' });
  } else {
    const base = slugify(`${value.name}-${value.pickupDate.slice(0, 4)}`) || `special-${Date.now()}`;
    eventId = base;
    for (let n = 2; await getItem('SPECIAL_MARKET', eventId); n++) eventId = `${base}-${n}`;
  }

  // Authoritative names/prices come from the current product offerings (PRODUCT_INVENTORY).
  const products = new Map((await queryByType('PRODUCT_INVENTORY')).map(p => [p.id, p]));
  for (const item of value.items) {
    if (!products.has(item.sku)) return response(400, { message: `Unknown product ${item.sku}.` });
  }

  const invMap = existing ? await getInventoryForEvent(eventId) : new Map();
  for (const item of value.items) {
    if (products.get(item.sku).archived && item.qty > 0 && !invMap.has(item.sku)) {
      return response(400, { message: `${products.get(item.sku).name} is archived and can't be added.` });
    }
  }
  const now = new Date().toISOString();
  const keptItems = value.items.filter(i => i.qty > 0 || (invMap.get(i.sku)?.totalQty || 0) > 0);
  const transactItems = [];

  for (const item of keptItems) {
    const inv = invMap.get(item.sku);
    if (!inv) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: { type: 'SPECIAL_INV', id: `${eventId}#${item.sku}`, eventId, sku: item.sku, totalQty: item.qty, currentQty: item.qty, updatedAt: now },
          ConditionExpression: 'attribute_not_exists(#id)',
          ExpressionAttributeNames: { '#id': 'id' },
        },
      });
      continue;
    }
    const oldTotal = Number(inv.totalQty || 0);
    const sold = oldTotal - Number(inv.currentQty || 0);
    if (item.qty < sold) {
      return response(400, { message: `${products.get(item.sku).name}: ${sold} already sold, so quantity can't go below ${sold}.` });
    }
    const delta = item.qty - oldTotal;
    if (delta === 0) continue;
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { type: 'SPECIAL_INV', id: `${eventId}#${item.sku}` },
        UpdateExpression: 'SET totalQty = :newTotal, currentQty = currentQty + :delta, updatedAt = :now',
        // Optimistic concurrency: fail if an order changed stock since we read it
        ConditionExpression: 'totalQty = :oldTotal AND currentQty = :oldCurrent',
        ExpressionAttributeValues: {
          ':newTotal': item.qty, ':delta': delta, ':now': now,
          ':oldTotal': oldTotal, ':oldCurrent': Number(inv.currentQty || 0),
        },
      },
    });
  }

  // Items removed from the event: only allowed if nothing sold
  const keptSkus = new Set(keptItems.map(i => i.sku));
  for (const [sku, inv] of invMap) {
    if (keptSkus.has(sku)) continue;
    const sold = Number(inv.totalQty || 0) - Number(inv.currentQty || 0);
    if (sold > 0) {
      const name = products.get(sku)?.name || sku;
      return response(400, { message: `${name} already has ${sold} sold and can't be removed. Set its quantity to ${sold} instead.` });
    }
    transactItems.push({ Delete: { TableName: TABLE_NAME, Key: { type: 'SPECIAL_INV', id: `${eventId}#${sku}` } } });
  }

  const event = {
    type: 'SPECIAL_MARKET',
    id: eventId,
    ...value,
    items: keptItems.map(i => {
      const p = products.get(i.sku);
      return { sku: i.sku, name: p.name, price: Number(p.price), maxPerOrder: i.maxPerOrder };
    }),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  transactItems.unshift({ Put: { TableName: TABLE_NAME, Item: event } });

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return response(409, { message: 'Stock changed while you were editing (an order just came in). Reload and try again.' });
    }
    console.error('Failed to save special market:', err);
    return response(500, { message: 'Failed to save special market.' });
  }

  await writeAuditLog(existing ? 'UPDATE' : 'CREATE', 'SPECIAL_MARKET', eventId, {
    status: event.status,
    items: keptItems.map(i => `${i.sku}:${i.qty}`),
  });

  const newInv = await getInventoryForEvent(eventId);
  return response(existing ? 200 : 201, {
    _nocache: true,
    specialMarket: { ...withInventory(event, newInv), state: computeState(event, newInv) },
  });
}

export async function deleteSpecialMarket(id, { response, writeAuditLog }) {
  const existing = await getItem('SPECIAL_MARKET', id);
  if (!existing) return response(404, { message: 'Special market not found.' });
  const invMap = await getInventoryForEvent(id);
  const anySold = [...invMap.values()].some(inv => Number(inv.totalQty || 0) > Number(inv.currentQty || 0));
  if (anySold) {
    return response(400, { message: 'This event has orders. Archive it instead of deleting.' });
  }
  const transactItems = [
    { Delete: { TableName: TABLE_NAME, Key: { type: 'SPECIAL_MARKET', id } } },
    ...[...invMap.keys()].map(sku => ({ Delete: { TableName: TABLE_NAME, Key: { type: 'SPECIAL_INV', id: `${id}#${sku}` } } })),
  ];
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  await writeAuditLog('DELETE', 'SPECIAL_MARKET', id, {});
  return response(200, { message: 'Special market deleted.' });
}

/** GET /api/admin/special-markets/{id}/orders — orders + bake list for one event. */
export async function listSpecialMarketOrders(id, response) {
  const ev = await getItem('SPECIAL_MARKET', id);
  if (!ev) return response(404, { message: 'Special market not found.' });

  const orders = [];
  let ExclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'by-pickup-date',
      KeyConditionExpression: '#pickupDate = :pickupDate',
      ExpressionAttributeNames: { '#pickupDate': 'pickupDate' },
      ExpressionAttributeValues: { ':pickupDate': ev.pickupDate },
      ExclusiveStartKey,
    }));
    orders.push(...(result.Items || []).filter(o => o.specialMarketId === id));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const totals = {};
  let revenueCents = 0;
  const STUCK_MS = 10 * 60 * 1000;
  const now = Date.now();
  const rows = orders
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map(o => {
      const status = String(o.status || 'NEW').toUpperCase();
      const isActive = status !== 'CANCELLED';
      if (isActive && o.paymentStatus === 'PAID') {
        revenueCents += Number(o.totalCents || 0);
        for (const item of o.items || []) {
          totals[item.sku] = totals[item.sku] || { sku: item.sku, name: item.name, qty: 0 };
          totals[item.sku].qty += Number(item.qty || 0);
        }
      }
      return {
        orderId: o.orderId,
        name: o.name,
        phone: o.phone,
        email: o.email,
        items: o.items || [],
        notes: o.notes || '',
        status,
        paymentStatus: o.paymentStatus,
        totalCents: o.totalCents,
        totalPaidCents: o.totalPaidCents,
        squarePaymentId: o.squarePaymentId || '',
        createdAt: o.createdAt,
        stuck: isActive && o.paymentStatus === 'PENDING_PAYMENT' && now - Date.parse(o.createdAt) > STUCK_MS,
      };
    });

  return response(200, {
    _nocache: true,
    specialMarket: { id: ev.id, name: ev.name, pickupDate: ev.pickupDate, pickupWindow: ev.pickupWindow, pickupLocation: ev.pickupLocation },
    orders: rows,
    totals: Object.values(totals).sort((a, b) => a.name.localeCompare(b.name)),
    paidOrderCount: rows.filter(r => r.status !== 'CANCELLED' && r.paymentStatus === 'PAID').length,
    revenueCents,
  });
}

/** Inventory key to restore when an order is cancelled. */
export function inventoryKeyForOrderItem(order, sku) {
  if (order?.orderType === 'SPECIAL' && order.specialMarketId) {
    return { type: 'SPECIAL_INV', id: `${order.specialMarketId}#${sku}` };
  }
  return { type: 'PRODUCT_INVENTORY', id: sku };
}
