/**
 * Product catalog — PRODUCT_INVENTORY rows are the source of truth for every product:
 * stock (weeklyQty/currentQty/available) AND catalog details (name, price, category,
 * description, allergens, image, seasonal, topSeller, archived).
 *
 * content/menu.json still provides defaults for the original 14 products; any field set
 * here overrides it on the site (see src/js/product-model.js). Products created from the
 * admin page exist only here.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.CONFIG_TABLE;

/** Category id -> SKU prefix. Must match categories in content/menu.json. */
export const CATEGORIES = {
  'standard-loaves': 'CL',
  'seasonal-loaves': 'SL',
  'non-loaf': 'NL',
};

const IMAGE_PATH_RE = /^\/(product-images|images)\/[\w./-]+\.(png|jpe?g|webp|gif)$/i;

function clean(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function parseAllergens(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map(a => clean(String(a), 30).toLowerCase()).filter(Boolean))].slice(0, 10);
}

/** Catalog fields included in API responses. */
export function toProductResponse(i, { admin = false } = {}) {
  const p = {
    sku: i.id,
    name: i.name,
    price: i.price,
    category: i.category || '',
    currentQty: i.currentQty,
    available: i.available,
    description: i.description,
    allergens: i.allergens,
    image: i.image,
    seasonal: i.seasonal,
    topSeller: i.topSeller,
  };
  if (admin) {
    Object.assign(p, {
      weeklyQty: i.weeklyQty,
      archived: !!i.archived,
      custom: !!i.custom,
      updatedAt: i.updatedAt,
      createdAt: i.createdAt,
    });
  }
  // Drop undefined so the site falls back to menu.json defaults
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}

/**
 * Validate catalog + stock fields. `partial` = only validate fields present (edits).
 * Returns { value } or { error }.
 */
function validateProductFields(body, { partial }) {
  const v = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('name')) {
    const name = clean(body.name, 80);
    if (name.length < 2) return { error: 'Product name is required (at least 2 characters).' };
    v.name = name;
  }
  if (!partial || has('category')) {
    if (!CATEGORIES[body.category]) return { error: 'Pick a category.' };
    v.category = body.category;
  }
  if (!partial || has('price')) {
    const price = Math.round(Number(body.price) * 100) / 100;
    if (!Number.isFinite(price) || price < 0.5 || price > 500) return { error: 'Price must be between $0.50 and $500.' };
    v.price = price;
  }
  if (has('description')) v.description = clean(body.description, 500);
  if (has('allergens')) v.allergens = parseAllergens(body.allergens);
  if (has('image')) {
    const image = clean(body.image, 300);
    if (image && !IMAGE_PATH_RE.test(image)) return { error: 'Image must be an uploaded photo.' };
    v.image = image;
  }
  for (const flag of ['seasonal', 'topSeller', 'available', 'archived']) {
    if (has(flag)) v[flag] = !!body[flag];
  }
  for (const qtyField of ['weeklyQty', 'currentQty']) {
    if (has(qtyField)) {
      const qty = Number(body[qtyField]);
      if (!Number.isInteger(qty) || qty < 0 || qty > 9999) {
        return { error: `${qtyField === 'weeklyQty' ? 'Weekly' : 'Current'} quantity must be a whole number from 0 to 9999.` };
      }
      v[qtyField] = qty;
    }
  }
  if (v.archived) v.available = false; // archived products can never be ordered
  return { value: v };
}

async function nextSku(prefix) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: '#type = :type AND begins_with(#id, :prefix)',
    ExpressionAttributeNames: { '#type': 'type', '#id': 'id' },
    ExpressionAttributeValues: { ':type': 'PRODUCT_INVENTORY', ':prefix': `${prefix}-` },
  }));
  const max = (result.Items || []).reduce((m, i) => {
    const n = parseInt(String(i.id).slice(prefix.length + 1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/** POST /api/admin/products — create a new product (catalog + stock). */
export async function createProduct(body, { response, writeAuditLog }) {
  const { value, error } = validateProductFields(body || {}, { partial: false });
  if (error) return response(400, { message: error });

  const now = new Date().toISOString();
  const weeklyQty = value.weeklyQty ?? 0;
  const item = {
    type: 'PRODUCT_INVENTORY',
    description: '',
    allergens: [],
    image: '',
    seasonal: false,
    topSeller: false,
    available: false,
    ...value,
    weeklyQty,
    currentQty: value.currentQty ?? weeklyQty,
    archived: false,
    custom: true,
    createdAt: now,
    updatedAt: now,
  };

  // Retry if two products are created at the same moment and race for the same SKU
  for (let attempt = 0; attempt < 3; attempt++) {
    item.id = await nextSku(CATEGORIES[value.category]);
    try {
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#id)',
        ExpressionAttributeNames: { '#id': 'id' },
      }));
      await writeAuditLog('CREATE', 'PRODUCT_INVENTORY', item.id, { name: item.name, price: item.price });
      return response(201, { _nocache: true, product: toProductResponse(item, { admin: true }) });
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') {
        console.error('Create product error:', err);
        return response(500, { message: 'Failed to create product.' });
      }
    }
  }
  return response(409, { message: 'Could not assign a product code. Please try again.' });
}

/** PUT /api/admin/inventory/{sku} — update stock and/or catalog fields. */
export async function updateProduct(sku, body, { response, writeAuditLog }) {
  const { value, error } = validateProductFields(body || {}, { partial: true });
  if (error) return response(400, { message: error });

  const names = { '#pkType': 'type', '#pkId': 'id' };
  const values = { ':now': new Date().toISOString() };
  const sets = ['updatedAt = :now'];
  Object.entries(value).forEach(([field, val], idx) => {
    names[`#f${idx}`] = field;
    values[`:v${idx}`] = val;
    sets.push(`#f${idx} = :v${idx}`);
  });

  try {
    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { type: 'PRODUCT_INVENTORY', id: sku },
      UpdateExpression: 'SET ' + sets.join(', '),
      ConditionExpression: 'attribute_exists(#pkType) AND attribute_exists(#pkId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    await writeAuditLog('UPDATE', 'PRODUCT_INVENTORY', sku, { fields: Object.keys(value) });
    return response(200, { _nocache: true, product: toProductResponse(result.Attributes, { admin: true }) });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return response(404, { message: 'Product not found.' });
    }
    console.error('Update product error:', e);
    return response(500, { message: 'Failed to update product.' });
  }
}

export async function getProduct(sku) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { type: 'PRODUCT_INVENTORY', id: sku } }));
  return result.Item || null;
}
