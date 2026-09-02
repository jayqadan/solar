// Minimal Stripe Checkout integration using the REST API directly (no SDK).
//
// Only ever use a TEST key (sk_test_...) with this app: it is a demo brokerage
// that does not actually execute share trades. The server refuses live keys.

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeEnabled() {
  return typeof process.env.STRIPE_SECRET_KEY === 'string' && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
}

export function refuseLiveKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && key.startsWith('sk_live_')) {
    throw new Error(
      'STRIPE_SECRET_KEY is a LIVE key. This demo app must not take real payments — use a test key (sk_test_...).'
    );
  }
}

async function stripeRequest(method, endpoint, params) {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe error ${res.status}`);
  }
  return json;
}

export async function createCheckoutSession({ order, baseUrl }) {
  const totalCents = Math.round(order.total * 100);
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(totalCents),
    'line_items[0][price_data][product_data][name]': `${order.units} × ${order.ticker} (${order.name}) — DEMO order`,
    'line_items[0][price_data][product_data][description]':
      'Demo brokerage order. No real shares are purchased.',
    'metadata[orderId]': order.id,
    success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
    cancel_url: `${baseUrl}/?cancelled=1`
  });
}

export async function retrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}
