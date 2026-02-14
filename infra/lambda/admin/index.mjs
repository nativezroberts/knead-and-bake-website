/**
 * Admin Lambda — CRUD for skip dates, announcements, news posts, and product inventory.
 * Also serves the public GET /api/market-config, GET /api/news, and GET /api/inventory endpoints.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE_NAME = process.env.CONFIG_TABLE;
const SITE_BUCKET = process.env.SITE_BUCKET;
const SITE_UPLOAD_PREFIX = process.env.SITE_UPLOAD_PREFIX || 'news-images';
const MAX_SKIP_DATES = 365;
const MAX_ANNOUNCEMENTS = 50;
const MAX_NEWS_POSTS = 200;
const MAX_NEWS_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_NEWS_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': statusCode === 200 && !body._nocache ? 'public, max-age=60, stale-while-revalidate=120' : 'no-store',
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

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function extensionFromContentType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  return null;
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

async function getByTypeAndId(type, id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { type, id },
  }));
  return result.Item || null;
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
      title: a.title || '',
      excerpt: a.excerpt || '',
      content: a.content || '',
      level: a.level || 'info',
      startDate: a.startDate,
    }));

  return response(200, { _nocache: true, skipDates, announcements });
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
      title: i.title || '',
      excerpt: i.excerpt || '',
      content: i.content || '',
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
  const { message, startDate, endDate, level, active, title, excerpt, content } = body;

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
    title: sanitize(title || '', 200),
    excerpt: sanitize(excerpt || '', 500),
    content: sanitize(content || '', 10000),
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
  const existing = await getByTypeAndId('ANNOUNCEMENT', id);
  if (!existing) {
    return response(404, { message: 'Announcement not found.' });
  }

  if (body.startDate !== undefined && !isValidDate(body.startDate)) {
    return response(400, { message: 'Start date must be a valid date (YYYY-MM-DD).' });
  }

  if (body.endDate !== undefined && !isValidDate(body.endDate)) {
    return response(400, { message: 'End date must be a valid date (YYYY-MM-DD).' });
  }

  if (body.message !== undefined && (typeof body.message !== 'string' || body.message.trim().length < 1)) {
    return response(400, { message: 'Announcement message is required.' });
  }

  const nextStartDate = body.startDate !== undefined ? body.startDate : existing.startDate;
  const nextEndDate = body.endDate !== undefined ? body.endDate : existing.endDate;

  if (!nextStartDate || !isValidDate(nextStartDate) || !nextEndDate || !isValidDate(nextEndDate)) {
    return response(400, { message: 'Valid start and end dates are required.' });
  }

  if (nextStartDate > nextEndDate) {
    return response(400, { message: 'Start date must be before end date.' });
  }

  const expNames = {
    '#pkType': 'type',
    '#pkId': 'id',
  };
  const expValues = {};
  const setClauses = [];

  if (body.title !== undefined) {
    setClauses.push('title = :ttl');
    expValues[':ttl'] = sanitize(body.title, 200);
  }
  if (body.excerpt !== undefined) {
    setClauses.push('excerpt = :exc');
    expValues[':exc'] = sanitize(body.excerpt, 500);
  }
  if (body.content !== undefined) {
    setClauses.push('content = :cnt');
    expValues[':cnt'] = sanitize(body.content, 10000);
  }
  if (body.message !== undefined) {
    setClauses.push('#msg = :msg');
    expNames['#msg'] = 'message';
    expValues[':msg'] = sanitize(body.message, 500);
  }
  if (body.startDate !== undefined) {
    setClauses.push('startDate = :sd');
    expValues[':sd'] = body.startDate;
  }
  if (body.endDate !== undefined) {
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
      ConditionExpression: 'attribute_exists(#pkType) AND attribute_exists(#pkId)',
      ExpressionAttributeNames: expNames,
      ExpressionAttributeValues: expValues,
      ReturnValues: 'ALL_NEW',
    }));
    return response(200, { announcement: result.Attributes });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return response(404, { message: 'Announcement not found.' });
    }
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

// ── Public news endpoint ──
async function handlePublicNews() {
  const [newsItems, announcementItems] = await Promise.all([
    queryByType('NEWS'),
    queryByType('ANNOUNCEMENT'),
  ]);
  const now = new Date().toISOString().slice(0, 10);

  const newsPosts = newsItems
    .filter(item =>
      item.active &&
      item.startDate <= now &&
      (!item.endDate || item.endDate >= now)
    )
    .map(item => ({
      id: item.id,
      type: 'news',
      title: item.title,
      subtitle: item.subtitle || '',
      excerpt: item.excerpt,
      content: item.content,
      startDate: item.startDate,
      endDate: item.endDate || null,
      slug: item.slug,
      createdAt: item.createdAt,
    }));

  const announcementPosts = announcementItems
    .filter(a =>
      a.active &&
      a.startDate <= now &&
      a.endDate >= now &&
      a.content && a.content.trim()
    )
    .map(a => ({
      id: a.id,
      type: 'announcement',
      title: a.title || 'Announcement',
      subtitle: '',
      excerpt: a.excerpt || a.message || '',
      content: a.content,
      startDate: a.startDate,
      endDate: a.endDate || null,
      slug: '',
      createdAt: a.createdAt,
    }));

  const posts = [...newsPosts, ...announcementPosts]
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  return response(200, { posts });
}

// ── News Posts CRUD ──
async function listNewsPosts() {
  const items = await queryByType('NEWS');
  return response(200, {
    _nocache: true,
    posts: items.map(i => ({
      id: i.id,
      title: i.title || '',
      subtitle: i.subtitle || '',
      excerpt: i.excerpt || '',
      content: i.content || '',
      startDate: i.startDate,
      endDate: i.endDate || null,
      slug: i.slug || '',
      active: i.active,
      createdAt: i.createdAt,
    })),
  });
}

async function createNewsPost(body) {
  const { title, subtitle, excerpt, content, startDate, endDate, active } = body;

  if (!title || typeof title !== 'string' || title.trim().length < 1) {
    return response(400, { message: 'Title is required.' });
  }

  if (!excerpt || typeof excerpt !== 'string' || excerpt.trim().length < 1) {
    return response(400, { message: 'Excerpt is required.' });
  }

  if (!content || typeof content !== 'string' || content.trim().length < 1) {
    return response(400, { message: 'Content is required.' });
  }

  if (!startDate || !isValidDate(startDate)) {
    return response(400, { message: 'A valid start date (YYYY-MM-DD) is required.' });
  }

  if (endDate && !isValidDate(endDate)) {
    return response(400, { message: 'End date must be a valid date (YYYY-MM-DD).' });
  }

  if (endDate && startDate > endDate) {
    return response(400, { message: 'Start date must be before end date.' });
  }

  const existing = await queryByType('NEWS');
  if (existing.length >= MAX_NEWS_POSTS) {
    return response(400, { message: `Maximum of ${MAX_NEWS_POSTS} news posts reached.` });
  }

  const item = {
    type: 'NEWS',
    id: randomUUID(),
    title: sanitize(title, 200),
    subtitle: sanitize(subtitle || '', 300),
    excerpt: sanitize(excerpt, 500),
    content: sanitize(content, 10000),
    startDate,
    slug: slugify(title),
    active: active !== false,
    createdAt: new Date().toISOString(),
  };

  if (endDate) {
    item.endDate = endDate;
  }

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return response(201, { post: item });
}

async function updateNewsPost(id, body) {
  const existing = await getByTypeAndId('NEWS', id);
  if (!existing) {
    return response(404, { message: 'News post not found.' });
  }

  if (body.startDate !== undefined && !isValidDate(body.startDate)) {
    return response(400, { message: 'Start date must be a valid date (YYYY-MM-DD).' });
  }

  if (body.endDate !== undefined && body.endDate !== null && body.endDate !== '' && !isValidDate(body.endDate)) {
    return response(400, { message: 'End date must be a valid date (YYYY-MM-DD).' });
  }

  const nextStartDate = body.startDate !== undefined ? body.startDate : existing.startDate;
  const nextEndDate = body.endDate !== undefined
    ? (body.endDate === null || body.endDate === '' ? null : body.endDate)
    : (existing.endDate || null);

  if (!nextStartDate || !isValidDate(nextStartDate)) {
    return response(400, { message: 'A valid start date (YYYY-MM-DD) is required.' });
  }

  if (nextEndDate && nextStartDate > nextEndDate) {
    return response(400, { message: 'Start date must be before end date.' });
  }

  const expNames = {
    '#pkType': 'type',
    '#pkId': 'id',
  };
  const expValues = {};
  const setClauses = [];

  if (body.title !== undefined) {
    setClauses.push('title = :ttl');
    expValues[':ttl'] = sanitize(body.title, 200);
    setClauses.push('slug = :slg');
    expValues[':slg'] = slugify(body.title);
  }
  if (body.subtitle !== undefined) {
    setClauses.push('subtitle = :sub');
    expValues[':sub'] = sanitize(body.subtitle, 300);
  }
  if (body.excerpt !== undefined) {
    setClauses.push('excerpt = :exc');
    expValues[':exc'] = sanitize(body.excerpt, 500);
  }
  if (body.content !== undefined) {
    setClauses.push('content = :cnt');
    expValues[':cnt'] = sanitize(body.content, 10000);
  }
  if (body.startDate !== undefined) {
    setClauses.push('startDate = :sd');
    expValues[':sd'] = body.startDate;
  }
  if (body.endDate !== undefined) {
    if (body.endDate === null || body.endDate === '') {
      setClauses.push('endDate = :ed');
      expValues[':ed'] = null;
    } else if (isValidDate(body.endDate)) {
      setClauses.push('endDate = :ed');
      expValues[':ed'] = body.endDate;
    }
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
      Key: { type: 'NEWS', id },
      UpdateExpression: 'SET ' + setClauses.join(', '),
      ConditionExpression: 'attribute_exists(#pkType) AND attribute_exists(#pkId)',
      ExpressionAttributeNames: expNames,
      ExpressionAttributeValues: expValues,
      ReturnValues: 'ALL_NEW',
    }));
    return response(200, { post: result.Attributes });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return response(404, { message: 'News post not found.' });
    }
    console.error('Update error:', e);
    return response(500, { message: 'Failed to update news post.' });
  }
}

async function deleteNewsPost(id) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { type: 'NEWS', id },
  }));
  return response(200, { message: 'News post deleted.' });
}

async function createNewsImageUploadUrl(body) {
  if (!SITE_BUCKET) {
    return response(500, { message: 'Upload bucket is not configured.' });
  }

  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName : '';
  const size = Number(body.size);

  if (!ALLOWED_NEWS_IMAGE_TYPES.has(contentType)) {
    return response(400, { message: 'Invalid image type. Allowed: JPG, PNG, WEBP, GIF.' });
  }

  if (!Number.isFinite(size) || size < 1 || size > MAX_NEWS_IMAGE_SIZE_BYTES) {
    return response(400, { message: 'Invalid image size. Max 5 MB.' });
  }

  if (!fileName || fileName.trim().length < 1) {
    return response(400, { message: 'File name is required.' });
  }

  const ext = extensionFromContentType(contentType);
  if (!ext) {
    return response(400, { message: 'Unsupported image type.' });
  }

  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const safeBaseName = slugify(nameWithoutExt) || 'image';
  const datePrefix = new Date().toISOString().slice(0, 10);
  const key = `${SITE_UPLOAD_PREFIX}/${datePrefix}/${randomUUID()}-${safeBaseName}.${ext}`;

  try {
    const putCommand = new PutObjectCommand({
      Bucket: SITE_BUCKET,
      Key: key,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 300 });
    return response(200, {
      uploadUrl,
      publicUrl: `/${key}`,
    });
  } catch (e) {
    console.error('Failed to create upload URL:', e);
    return response(500, { message: 'Failed to prepare image upload.' });
  }
}

// ── Public inventory endpoint ──
async function handlePublicInventory() {
  const items = await queryByType('PRODUCT_INVENTORY');
  const products = items
    .filter(i => i.available)
    .map(i => ({
      sku: i.id,
      name: i.name,
      price: i.price,
      currentQty: i.currentQty,
      available: i.available && i.currentQty > 0,
    }));
  return response(200, { products });
}

// ── Product Inventory CRUD ──
async function listProductInventory() {
  const items = await queryByType('PRODUCT_INVENTORY');
  return response(200, {
    _nocache: true,
    products: items.map(i => ({
      sku: i.id,
      name: i.name,
      weeklyQty: i.weeklyQty,
      currentQty: i.currentQty,
      price: i.price,
      category: i.category || '',
      available: i.available,
      updatedAt: i.updatedAt,
      createdAt: i.createdAt,
    })),
  });
}

async function updateProductInventory(sku, body) {
  const existing = await getByTypeAndId('PRODUCT_INVENTORY', sku);
  if (!existing) {
    return response(404, { message: 'Product inventory not found.' });
  }

  const expNames = {
    '#pkType': 'type',
    '#pkId': 'id',
  };
  const expValues = {};
  const setClauses = ['updatedAt = :now'];
  expValues[':now'] = new Date().toISOString();

  if (body.weeklyQty !== undefined) {
    const qty = parseInt(body.weeklyQty, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      return response(400, { message: 'Weekly quantity must be a non-negative integer.' });
    }
    setClauses.push('weeklyQty = :wq');
    expValues[':wq'] = qty;
  }

  if (body.currentQty !== undefined) {
    const qty = parseInt(body.currentQty, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      return response(400, { message: 'Current quantity must be a non-negative integer.' });
    }
    setClauses.push('currentQty = :cq');
    expValues[':cq'] = qty;
  }

  if (body.available !== undefined) {
    setClauses.push('available = :avl');
    expValues[':avl'] = !!body.available;
  }

  try {
    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { type: 'PRODUCT_INVENTORY', id: sku },
      UpdateExpression: 'SET ' + setClauses.join(', '),
      ConditionExpression: 'attribute_exists(#pkType) AND attribute_exists(#pkId)',
      ExpressionAttributeNames: expNames,
      ExpressionAttributeValues: expValues,
      ReturnValues: 'ALL_NEW',
    }));
    return response(200, { product: result.Attributes });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return response(404, { message: 'Product inventory not found.' });
    }
    console.error('Update error:', e);
    return response(500, { message: 'Failed to update product inventory.' });
  }
}

async function resetAllInventory() {
  const items = await queryByType('PRODUCT_INVENTORY');
  if (items.length === 0) {
    return response(200, { message: 'No inventory items to reset.', updated: 0 });
  }

  const now = new Date().toISOString();
  // Update each item: set currentQty = weeklyQty
  const updatePromises = items.map(item =>
    ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { type: 'PRODUCT_INVENTORY', id: item.id },
      UpdateExpression: 'SET currentQty = weeklyQty, updatedAt = :now',
      ExpressionAttributeValues: { ':now': now },
    }))
  );

  await Promise.all(updatePromises);
  return response(200, { message: 'Inventory reset to weekly defaults.', updated: items.length });
}

// Menu items to seed inventory from (matches content/menu.json)
const MENU_ITEMS = [
  { sku: 'CL-001', name: 'Classic Plain Sourdough', price: 10.00, category: 'standard-loaves' },
  { sku: 'CL-002', name: 'Classic Plain Sourdough Sandwich Loaf', price: 10.00, category: 'standard-loaves' },
  { sku: 'CL-003', name: 'Jalapeño Cheddar Sourdough', price: 13.00, category: 'standard-loaves' },
  { sku: 'CL-004', name: 'Roasted Garlic, Olive & Rosemary Sourdough', price: 13.00, category: 'standard-loaves' },
  { sku: 'CL-005', name: 'Italian Parmesan Sourdough', price: 13.00, category: 'standard-loaves' },
  { sku: 'CL-006', name: 'Cinnamon Brown Sugar Sourdough', price: 13.00, category: 'standard-loaves' },
  { sku: 'CL-007', name: 'Chocolate Chip Sourdough', price: 13.00, category: 'standard-loaves' },
  { sku: 'SL-001', name: 'Orange Cranberry Walnut Sourdough', price: 13.00, category: 'seasonal-loaves' },
  { sku: 'SL-002', name: 'Lemon Blueberry Sourdough', price: 13.00, category: 'seasonal-loaves' },
  { sku: 'SL-003', name: 'Pumpkin Spice Sourdough', price: 13.00, category: 'seasonal-loaves' },
  { sku: 'NL-001', name: 'Sourdough Focaccia - Cinnamon Brown Sugar(Half Sheet)', price: 15.00, category: 'non-loaf' },
  { sku: 'NL-002', name: 'Sourdough Discard Crackers', price: 7.00, category: 'non-loaf' },
  { sku: 'NL-003', name: 'Sourdough English Muffins (Pack of 6)', price: 5.00, category: 'non-loaf' },
  { sku: 'NL-004', name: 'Sourdough Starter (Jar)', price: 15.00, category: 'non-loaf' },
];

async function initProductInventory() {
  const existing = await queryByType('PRODUCT_INVENTORY');
  const existingSkus = new Set(existing.map(i => i.id));

  const now = new Date().toISOString();
  const toCreate = MENU_ITEMS.filter(m => !existingSkus.has(m.sku));

  if (toCreate.length === 0) {
    return response(200, { message: 'All products already initialized.', created: 0 });
  }

  // Write in batches of 25 (DynamoDB BatchWrite limit)
  for (let i = 0; i < toCreate.length; i += 25) {
    const batch = toCreate.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(m => ({
          PutRequest: {
            Item: {
              type: 'PRODUCT_INVENTORY',
              id: m.sku,
              name: m.name,
              weeklyQty: 0,
              currentQty: 0,
              price: m.price,
              category: m.category,
              available: false,
              createdAt: now,
              updatedAt: now,
            },
          },
        })),
      },
    }));
  }

  return response(201, { message: `Initialized ${toCreate.length} product(s).`, created: toCreate.length });
}

// ── Router ──
export async function handler(event) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;

  // Public endpoints
  if (method === 'GET' && path === '/api/market-config') {
    return handlePublicRead();
  }

  if (method === 'GET' && path === '/api/news') {
    return handlePublicNews();
  }

  if (method === 'GET' && path === '/api/inventory') {
    return handlePublicInventory();
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

  // News posts
  if (path === '/api/admin/news/upload-url' && method === 'POST') {
    return createNewsImageUploadUrl(body);
  }

  if (path === '/api/admin/news') {
    if (method === 'GET') return listNewsPosts();
    if (method === 'POST') return createNewsPost(body);
  }

  if (path.startsWith('/api/admin/news/')) {
    const id = decodeURIComponent(path.split('/').pop());
    if (method === 'PUT') return updateNewsPost(id, body);
    if (method === 'DELETE') return deleteNewsPost(id);
  }

  // Product inventory
  if (path === '/api/admin/inventory') {
    if (method === 'GET') return listProductInventory();
    if (method === 'POST') return initProductInventory();
  }

  if (path === '/api/admin/inventory/reset' && method === 'POST') {
    return resetAllInventory();
  }

  if (path.startsWith('/api/admin/inventory/') && !path.includes('/reset')) {
    const sku = decodeURIComponent(path.split('/').pop());
    if (method === 'PUT') return updateProductInventory(sku, body);
  }

  return response(404, { message: 'Not found' });
}
