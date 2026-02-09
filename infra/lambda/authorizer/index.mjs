/**
 * Lambda Authorizer — verifies JWT tokens for admin API routes.
 * JWT secret is stored in AWS SSM Parameter Store.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac } from 'crypto';

const ssm = new SSMClient({});
let cachedJwtSecret = null;

async function getJwtSecret() {
  if (!cachedJwtSecret) {
    const res = await ssm.send(new GetParameterCommand({
      Name: '/knead-bake/jwt-secret',
      WithDecryption: true,
    }));
    cachedJwtSecret = res.Parameter.Value;
  }
  return cachedJwtSecret;
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  // Verify signature
  const expectedSig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (signature !== expectedSig) return null;

  // Decode payload
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) return null;

    return decoded;
  } catch {
    return null;
  }
}

export async function handler(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return {
      isAuthorized: false,
    };
  }

  try {
    const secret = await getJwtSecret();
    const payload = verifyJwt(token, secret);

    if (!payload || payload.sub !== 'admin') {
      return { isAuthorized: false };
    }

    return {
      isAuthorized: true,
      context: {
        sub: payload.sub,
      },
    };
  } catch (err) {
    console.error('Authorizer error:', err);
    return { isAuthorized: false };
  }
}
