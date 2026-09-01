// Stripe Billing (subscriptions) via the REST API — test mode only.
// SubSweep Pro is a recurring subscription created in the Stripe dashboard;
// set STRIPE_SECRET_KEY (sk_test_...) and STRIPE_PRICE_ID (price_...).
// Live keys are refused: this is a demo build.

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeEnabled() {
  return (
    typeof process.env.STRIPE_SECRET_KEY === 'string' &&
    process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') &&
    typeof process.env.STRIPE_PRICE_ID === 'string'
  );
}

export function refuseLiveKey() {
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('STRIPE_SECRET_KEY is a LIVE key. This demo build only accepts test keys (sk_test_...).');
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
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error ${res.status}`);
  return json;
}

export async function createSubscriptionCheckout({ sessionId, baseUrl }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': process.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'metadata[appSession]': sessionId,
    'subscription_data[metadata][appSession]': sessionId,
    success_url: `${baseUrl}/?checkout_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?cancelled=1`
  });
}

export async function retrieveCheckoutSession(checkoutSessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`);
}
