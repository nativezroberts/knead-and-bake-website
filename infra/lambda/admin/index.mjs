/**
 * Admin Lambda — CRUD for skip dates and announcements.
 * Also serves the public GET /api/market-config endpoint.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.CONFIG_TABLE;
const MAX_SKIP_DATES = 365;
const MAX_ANNOUNCEMENTS = 50;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': statusCode === 200 && !body._nocache ? 'public, max-age=300' : 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr + 'T00:00:00').getTime());
}

function isSaturday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 6;
}

async function queryByType(type) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: '#type = :type',
    ExpressionAttributeNames: { '#type': 'type' },
    ExpressionAttributeValues: { ':type': type },
  }));
  return result.Items || [];
}

// ── Public endpoint ──
async function handlePublicRead() {
  const [skipItems, announcementItems] = await Promise.all([
    queryByType('SKIP_DATE'),
    queryByType('ANNOUNCEMENT'),
  ]);

  const now = new Date().toISOString().slice(0, 10);
  const skipDates = skipItems.map(item => ({
    date: item.id,
    reason: item.reason || '',
  }));

  const announcements = announcementItems
    .filter(a => a.active && a.startDate <= now && a.endDate >= now)
    .map(a => ({
      id: a.id,
      message: a.message,
      level: a.level || 'info',
    }));

  return response(200, { skipDates, announcements });
}

// ── Skip Dates CRUD ──
async function listSkipDates() {
  const items = await queryByType('SKIP_DATE');
  return response(200, { _nocache: true, skipDates: items.map(i => ({ date: i.id, reason: i.reason, createdAt: i.createdAt })) });
}

async function createSkipDate(body) {
  const { date, reason } = body;

  if (!date || !isValidDate(date)) {
    return response(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  }

  if (!isSaturday(date)) {
    return response(400, { message: 'Skip dates must fall on a Saturday.' });
  }

  // Check max count
  const existing = await queryByType('SKIP_DATE');
  if (existing.length >= MAX_SKIP_DATES) {
    return response(400, { message: `Maximum of ${MAX_SKIP_DATES} skip dates reached.` });
  }

  const item = {
    type: 'SKIP_DATE',
    id: date,
    reason: sanitize(reason || '', 200),
    createdAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return response(201, { skipDate: { date: item.id, reason: item.reason } });
}

async function deleteSkipDate(id) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { type: 'SKIP_DATE', id },
  }));
  return response(200, { message: 'Skip date deleted.' });
}

// ── Announcements CRUD ──
async function listAnnouncements() {
  const items = await queryByType('ANNOUNCEMENT');
  return response(200, {
    _nocache: true,
    announcements: items.map(i => ({
      id: i.id,
      message: i.message,
      startDate: i.startDate,
      endDate: i.endDate,
      level: i.level,
      active: i.active,
      createdAt: i.createdAt,
    })),
  });
}

async function createAnnouncement(body) {
  const { message, startDate, endDate, level, active } = body;

  if (!message || typeof message !== 'string' || message.trim().length < 1) {
    return response(400, { message: 'Announcement message is required.' });
  }

  if (!startDate || !isValidDate(startDate) || !endDate || !isValidDate(endDate)) {
    return response(400, { message: 'Valid start and end dates are required.' });
  }

  if (startDate > endDate) {
    return response(400, { message: 'Start date must be before end date.' });
  }

  const existing = await queryByType('ANNOUNCEMENT');
  if (existing.length >= MAX_ANNOUNCEMENTS) {
    return response(400, { message: `Maximum of ${MAX_ANNOUNCEMENTS} announcements reached.` });
  }

  const item = {
    type: 'ANNOUNCEMENT',
    id: randomUUID(),
    message: sanitize(message, 500),
    startDate,
    endDate,
    level: level === 'warning' ? 'warning' : 'info',
    active: active !== false,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return response(201, { announcement: item });
}

async function updateAnnouncement(id, body) {
  const updates = {};
  const expNames = {};
  const expValues = {};
  const setClauses = [];

  if (body.message !== undefined) {
    setClauses.push('#msg = :msg');
    expNames['#msg'] = 'message';
    expValues[':msg'] = sanitize(body.message, 500);
  }
  if (body.startDate !== undefined && isValidDate(body.startDate)) {
    setClauses.push('startDate = :sd');
    expValues[':sd'] = body.startDate;
  }
  if (body.endDate !== undefined && isValidDate(body.endDate)) {
    setClauses.push('endDate = :ed');
    expValues[':ed'] = body.endDate;
  }
  if (body.level !== undefined) {
    setClauses.push('#lvl = :lvl');
    expNames['#lvl'] = 'level';
    expValues[':lvl'] = body.level === 'warning' ? 'warning' : 'info';
  }
  if (body.active !== undefined) {
    setClauses.push('active = :act');
    expValues[':act'] = !!body.active;
  }

  if (setClauses.length === 0) {
    return response(400, { message: 'No valid fields to update.' });
  }

  try {
    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { type: 'ANNOUNCEMENT', id },
      UpdateExpression: 'SET ' + setClauses.join(', '),
      ExpressionAttributeNames: Object.keys(expNames).length > 0 ? expNames : undefined,
      ExpressionAttributeValues: expValues,
      ReturnValues: 'ALL_NEW',
    }));
    return response(200, { announcement: result.Attributes });
  } catch (e) {
    console.error('Update error:', e);
    return response(500, { message: 'Failed to update announcement.' });
  }
}

async function deleteAnnouncement(id) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { type: 'ANNOUNCEMENT', id },
  }));
  return response(200, { message: 'Announcement deleted.' });
}

// ── Router ──
export async function handler(event) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;

  // Public endpoint
  if (method === 'GET' && path === '/api/market-config') {
    return handlePublicRead();
  }

  // Admin endpoints — auth is handled by the Lambda authorizer at API Gateway level
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return response(400, { message: 'Invalid JSON' });
    }
  }

  // Skip dates
  if (path === '/api/admin/skip-dates') {
    if (method === 'GET') return listSkipDates();
    if (method === 'POST') return createSkipDate(body);
  }

  if (path.startsWith('/api/admin/skip-dates/') && method === 'DELETE') {
    const id = decodeURIComponent(path.split('/').pop());
    return deleteSkipDate(id);
  }

  // Announcements
  if (path === '/api/admin/announcements') {
    if (method === 'GET') return listAnnouncements();
    if (method === 'POST') return createAnnouncement(body);
  }

  if (path.startsWith('/api/admin/announcements/')) {
    const id = decodeURIComponent(path.split('/').pop());
    if (method === 'PUT') return updateAnnouncement(id, body);
    if (method === 'DELETE') return deleteAnnouncement(id);
  }

  return response(404, { message: 'Not found' });
}
