/**
 * Auth Lambda — handles login with bcrypt password verification and JWT issuance.
 * Password hash and JWT secret are stored in AWS SSM Parameter Store.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHmac, timingSafeEqual } from 'crypto';

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONFIG_TABLE = process.env.CONFIG_TABLE;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 900; // 15 minutes

// Cache SSM params for the lifetime of the Lambda instance
let cachedPasswordHash = null;
let cachedJwtSecret = null;

async function getSSMParam(name) {
  const res = await ssm.send(new GetParameterCommand({
    Name: name,
    WithDecryption: true,
  }));
  return res.Parameter.Value;
}

async function getPasswordHash() {
  if (!cachedPasswordHash) {
    cachedPasswordHash = await getSSMParam('/knead-bake/admin-password-hash');
  }
  return cachedPasswordHash;
}

async function getJwtSecret() {
  if (!cachedJwtSecret) {
    cachedJwtSecret = await getSSMParam('/knead-bake/jwt-secret');
  }
  return cachedJwtSecret;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Simple bcrypt-like verification using SHA-256 HMAC
// The stored hash format is: sha256:<hex>
// Generated via: echo -n "password" | openssl dgst -sha256 -hmac "knead-bake-salt" -hex
async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('sha256:')) {
    const expectedHex = storedHash.slice(7);
    const computedHex = createHmac('sha256', 'knead-bake-salt')
      .update(password)
      .digest('hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const computed = Buffer.from(computedHex, 'hex');
    if (expected.length !== computed.length) return false;
    return timingSafeEqual(expected, computed);
  }
  // Plain text comparison (not recommended, but fallback)
  const a = Buffer.from(password);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Simple JWT implementation (HS256) — no external dependencies
function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function createJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

// Rate limiting via DynamoDB
async function checkRateLimit(ip) {
  const now = Math.floor(Date.now() / 1000);
  const key = { type: 'LOGIN_ATTEMPT', id: ip };

  try {
    const result = await ddb.send(new GetCommand({
      TableName: CONFIG_TABLE,
      Key: key,
    }));

    const item = result.Item;
    if (!item) return { blocked: false };

    // Check if lockout window has passed
    if (now - item.firstAttempt > LOCKOUT_WINDOW_SECONDS) {
      return { blocked: false };
    }

    if (item.failCount >= MAX_FAILED_ATTEMPTS) {
      return { blocked: true, retryAfter: LOCKOUT_WINDOW_SECONDS - (now - item.firstAttempt) };
    }

    return { blocked: false, currentCount: item.failCount };
  } catch (e) {
    console.error('Rate limit check error:', e);
    return { blocked: false };
  }
}

async function recordFailedAttempt(ip) {
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await ddb.send(new GetCommand({
      TableName: CONFIG_TABLE,
      Key: { type: 'LOGIN_ATTEMPT', id: ip },
    }));

    const item = result.Item;
    let failCount = 1;
    let firstAttempt = now;

    if (item && now - item.firstAttempt <= LOCKOUT_WINDOW_SECONDS) {
      failCount = (item.failCount || 0) + 1;
      firstAttempt = item.firstAttempt;
    }

    await ddb.send(new PutCommand({
      TableName: CONFIG_TABLE,
      Item: {
        type: 'LOGIN_ATTEMPT',
        id: ip,
        failCount,
        firstAttempt,
        ttl: now + LOCKOUT_WINDOW_SECONDS + 60, // Auto-expire via DynamoDB TTL
      },
    }));
  } catch (e) {
    console.error('Record failed attempt error:', e);
  }
}

async function clearFailedAttempts(ip) {
  try {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await ddb.send(new DeleteCommand({
      TableName: CONFIG_TABLE,
      Key: { type: 'LOGIN_ATTEMPT', id: ip },
    }));
  } catch (e) {
    // Non-critical
  }
}

export async function handler(event) {
  if (event.requestContext?.http?.method !== 'POST') {
    return response(405, { message: 'Method not allowed' });
  }

  const ip = event.requestContext?.http?.sourceIp || 'unknown';

  // Check rate limit
  const rateCheck = await checkRateLimit(ip);
  if (rateCheck.blocked) {
    return response(429, {
      message: `Too many failed attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`,
    });
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

  const { password } = body;
  if (!password || typeof password !== 'string') {
    return response(400, { message: 'Password is required.' });
  }

  // Verify password
  const storedHash = await getPasswordHash();
  const valid = await verifyPassword(password, storedHash);

  if (!valid) {
    await recordFailedAttempt(ip);
    return response(401, { message: 'Invalid password.' });
  }

  // Clear failed attempts on success
  await clearFailedAttempts(ip);

  // Issue JWT
  const secret = await getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const token = createJwt({
    sub: 'admin',
    iat: now,
    exp: now + 7200, // 2 hours
  }, secret);

  return response(200, { token });
}
