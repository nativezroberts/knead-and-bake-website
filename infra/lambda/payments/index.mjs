/**
 * Payment Lambda — processes Square Web Payments after order submission.
 * Takes an orderId + Square card nonce, calls Square CreatePayment API,
 * and updates the order record with payment status.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const PROCESSING_FEE_CENTS = 30;

// Cache SSM parameters for warm Lambda starts
let cachedSquareAccessToken = null;
let cachedSquareLocationId = null;

async function getSSMParam(name, decrypt = false) {
  const result = await ssm.send(new GetParameterCommand({
    Name: name,
    WithDecryption: decrypt,
  }));
  return result.Parameter.Value;
}

async function getSquareCredentials() {
  if (!cachedSquareAccessToken) {
    cachedSquareAccessToken = await getSSMParam('/knead-bake/square-access-token', true);
  }
  if (!cachedSquareLocationId) {
    cachedSquareLocationId = await getSSMParam('/knead-bake/square-location-id', true);
  }
  return { accessToken: cachedSquareAccessToken, locationId: cachedSquareLocationId };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.requestContext?.http?.method !== 'POST') {
    return response(405, { message: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { message: 'Invalid JSON' });
  }

  const { orderId, nonce } = body;

  // Validate input
  if (!orderId || typeof orderId !== 'string') {
    return response(400, { message: 'orderId is required.' });
  }
  if (!nonce || typeof nonce !== 'string') {
    return response(400, { message: 'Card payment nonce is required.' });
  }

  // Look up the order
  let order;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
    }));
    order = result.Item;
  } catch (err) {
    console.error('Failed to read order:', err);
    return response(500, { message: 'Failed to look up order.' });
  }

  if (!order) {
    return response(404, { message: 'Order not found.' });
  }

  if (order.paymentStatus === 'PAID') {
    return response(400, { message: 'Order has already been paid.' });
  }

  if (order.status === 'REJECTED' || order.status === 'CANCELLED') {
    return response(400, { message: 'This order cannot be paid.' });
  }

  if (!order.totalCents || order.totalCents <= 0) {
    return response(400, { message: 'Order has no valid total.' });
  }

  const amountCents = order.totalCents + PROCESSING_FEE_CENTS;

  // Get Square credentials
  let accessToken, locationId;
  try {
    ({ accessToken, locationId } = await getSquareCredentials());
  } catch (err) {
    console.error('Failed to read Square credentials from SSM:', err);
    return response(500, { message: 'Payment service configuration error.' });
  }

  // Call Square Payments API
  let squarePaymentId;
  try {
    const squareRes = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-12-18',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_id: nonce,
        idempotency_key: orderId,
        amount_money: {
          amount: amountCents,
          currency: 'USD',
        },
        location_id: locationId,
        note: `Knead & Bake TX - Order #${orderId.slice(0, 8)}`,
      }),
    });

    const squareData = await squareRes.json();

    if (!squareRes.ok) {
      console.error('Square API error:', JSON.stringify(squareData));
      const errorDetail = squareData.errors?.[0]?.detail || 'Payment was declined. Please try again.';
      return response(400, { message: errorDetail });
    }

    squarePaymentId = squareData.payment?.id;
  } catch (err) {
    console.error('Square API call failed:', err);
    return response(500, { message: 'Payment processing failed. Please try again.' });
  }

  // Update order record with payment info
  const now = new Date().toISOString();
  try {
    await ddb.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET paymentStatus = :ps, squarePaymentId = :spid, paymentMethod = :pm, paidAt = :pa, processingFeeCents = :fee, totalPaidCents = :tpc',
      ConditionExpression: 'attribute_exists(orderId)',
      ExpressionAttributeValues: {
        ':ps': 'PAID',
        ':spid': squarePaymentId || 'unknown',
        ':pm': 'SQUARE',
        ':pa': now,
        ':fee': PROCESSING_FEE_CENTS,
        ':tpc': amountCents,
      },
    }));
  } catch (err) {
    // Payment succeeded at Square but DynamoDB update failed — log for manual reconciliation
    console.error('CRITICAL: Payment succeeded but order update failed:', { orderId, squarePaymentId, err });
    return response(200, {
      success: true,
      orderId,
      squarePaymentId,
      warning: 'Payment processed but order status update may be delayed.',
    });
  }

  return response(200, {
    success: true,
    orderId,
    squarePaymentId,
  });
}
