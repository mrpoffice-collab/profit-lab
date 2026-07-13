// Stripe integration — zero-dependency REST client + webhook signature verification.
const crypto = require('crypto');

const KEY = process.env.STRIPE_SECRET_KEY;
const APP_URL = process.env.APP_URL || 'http://localhost:4700';
const PRICES = {
  founding: process.env.STRIPE_PRICE_FOUNDING,
  standard: process.env.STRIPE_PRICE_STANDARD,
};

async function stripeReq(path, params) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64'),
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message || 'unknown'}`);
  return data;
}

function createCheckoutSession({ accountId, reportId, plan }) {
  const price = PRICES[plan];
  if (!price) throw new Error('Unknown plan: ' + plan);
  return stripeReq('/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: String(accountId),
    'metadata[account_id]': String(accountId),
    'metadata[report_id]': reportId || '',
    'metadata[plan]': plan,
    'subscription_data[metadata][account_id]': String(accountId),
    success_url: `${APP_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: reportId ? `${APP_URL}/r/${reportId}` : `${APP_URL}/`,
    allow_promotion_codes: 'false',
  });
}

const retrieveSession = id => stripeReq(`/checkout/sessions/${encodeURIComponent(id)}`);

// Verify a Stripe webhook signature (Stripe-Signature header, whsec_ secret).
function verifyWebhook(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false; // 10-min tolerance
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch { return false; }
}

module.exports = { createCheckoutSession, retrieveSession, verifyWebhook };
