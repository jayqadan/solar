import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getUniverse, getStock, getHistory } from './lib/data.js';
import { analyse } from './lib/predict.js';
import { listOrders, addOrder, hasOrder, getHoldings } from './lib/store.js';
import { stripeEnabled, refuseLiveKey, createCheckoutSession, retrieveCheckoutSession } from './lib/stripe.js';

refuseLiveKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BROKERAGE_FEE_AUD = 5;
const MAX_ORDER_AUD = 50000;

// Orders awaiting Stripe payment, keyed by order id. Filled orders go to the store.
const pendingOrders = new Map();

async function buildQuote(stock) {
  const { closes, source } = await getHistory(stock);
  const prediction = analyse(closes);
  return {
    ticker: stock.ticker,
    name: stock.name,
    sector: stock.sector,
    dataSource: source,
    ...prediction
  };
}

app.get('/api/config', (req, res) => {
  res.json({
    paymentsMode: stripeEnabled() ? 'stripe-test' : 'demo',
    brokerageFeeAud: BROKERAGE_FEE_AUD,
    maxOrderAud: MAX_ORDER_AUD,
    liveData: process.env.LIVE_DATA === '1'
  });
});

app.get('/api/stocks', async (req, res) => {
  try {
    const quotes = await Promise.all(getUniverse().map(buildQuote));
    quotes.sort((a, b) => b.expectedGainPct - a.expectedGainPct);
    res.json({ asOf: new Date().toISOString(), stocks: quotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocks/:ticker', async (req, res) => {
  const stock = getStock(req.params.ticker);
  if (!stock) return res.status(404).json({ error: 'Unknown ticker' });
  try {
    const { closes, source } = await getHistory(stock);
    const quote = await buildQuote(stock);
    res.json({ ...quote, dataSource: source, closes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create an order. In demo mode the "payment" is simulated immediately;
// with a Stripe test key the client is redirected to Stripe-hosted Checkout.
app.post('/api/checkout', async (req, res) => {
  const { ticker, units } = req.body || {};
  const stock = getStock(String(ticker || ''));
  const qty = Math.floor(Number(units));
  if (!stock) return res.status(400).json({ error: 'Unknown ticker' });
  if (!Number.isFinite(qty) || qty < 1 || qty > 100000) {
    return res.status(400).json({ error: 'Units must be a whole number of at least 1' });
  }

  try {
    const { closes } = await getHistory(stock);
    const unitPrice = closes[closes.length - 1];
    const total = Number((qty * unitPrice + BROKERAGE_FEE_AUD).toFixed(2));
    if (total > MAX_ORDER_AUD) {
      return res.status(400).json({ error: `Demo orders are capped at A$${MAX_ORDER_AUD.toLocaleString()}` });
    }

    const order = {
      id: crypto.randomUUID(),
      ticker: stock.ticker,
      name: stock.name,
      units: qty,
      unitPrice,
      feeAud: BROKERAGE_FEE_AUD,
      total,
      currency: 'AUD',
      createdAt: new Date().toISOString()
    };

    if (stripeEnabled()) {
      pendingOrders.set(order.id, order);
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const session = await createCheckoutSession({ order, baseUrl });
      return res.json({ mode: 'stripe-test', checkoutUrl: session.url, order });
    }

    // Demo mode: no card details are collected anywhere; the payment is simulated.
    const filled = addOrder({ ...order, status: 'filled', paymentRef: 'demo-simulated' });
    return res.json({ mode: 'demo', order: filled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe success redirect lands here (via the frontend) to confirm payment.
app.get('/api/checkout/confirm', async (req, res) => {
  const { session_id: sessionId, order_id: orderId } = req.query;
  if (!stripeEnabled()) return res.status(400).json({ error: 'Stripe is not configured' });
  if (!sessionId || !orderId) return res.status(400).json({ error: 'Missing session_id or order_id' });
  if (hasOrder(orderId)) return res.json({ status: 'filled', alreadyRecorded: true });

  const order = pendingOrders.get(orderId);
  if (!order) return res.status(404).json({ error: 'Unknown or expired order' });

  try {
    const session = await retrieveCheckoutSession(String(sessionId));
    if (session?.metadata?.orderId !== orderId) {
      return res.status(400).json({ error: 'Session does not match order' });
    }
    if (session.payment_status !== 'paid') {
      return res.json({ status: 'pending', paymentStatus: session.payment_status });
    }
    pendingOrders.delete(orderId);
    const filled = addOrder({ ...order, status: 'filled', paymentRef: session.id });
    res.json({ status: 'filled', order: filled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/portfolio', async (req, res) => {
  try {
    const holdings = await Promise.all(
      getHoldings().map(async (h) => {
        const stock = getStock(h.ticker);
        const { closes } = await getHistory(stock);
        const price = closes[closes.length - 1];
        const value = Number((h.units * price).toFixed(2));
        return {
          ...h,
          currentPrice: price,
          value,
          gainAud: Number((value - h.cost).toFixed(2)),
          gainPct: Number((((value - h.cost) / h.cost) * 100).toFixed(2))
        };
      })
    );
    res.json({ holdings, orders: listOrders() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ASX Gain Predictor (demo) running at http://localhost:${PORT}`);
  console.log(`Payments mode: ${stripeEnabled() ? 'Stripe TEST' : 'demo (simulated)'}`);
});
