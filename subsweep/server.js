import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatementCsv } from './lib/parse.js';
import { detectSubscriptions, refundEmail } from './lib/detect.js';
import { sampleTransactions } from './lib/sample.js';
import * as basiq from './lib/basiq.js';
import { stripeEnabled, refuseLiveKey, createSubscriptionCheckout, retrieveCheckoutSession } from './lib/stripe.js';

refuseLiveKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3100;
const FREE_TIER_LIMIT = 3;

// In-memory per-browser sessions (privacy by default: transactions are held
// only in memory for the session and never written to disk).
const sessions = new Map(); // ssid -> { transactions, source, basiqUserId, pro }

function getSession(req, res) {
  const cookie = (req.headers.cookie || '').match(/ssid=([a-f0-9-]{36})/);
  let ssid = cookie?.[1];
  if (!ssid || !sessions.has(ssid)) {
    ssid = crypto.randomUUID();
    sessions.set(ssid, { transactions: null, source: null, basiqUserId: null, pro: false });
    res.setHeader('Set-Cookie', `ssid=${ssid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return { ssid, state: sessions.get(ssid) };
}

function analysisFor(state) {
  if (!state.transactions?.length) return null;
  const result = detectSubscriptions(state.transactions);
  const locked = !state.pro && result.subscriptions.length > FREE_TIER_LIMIT;
  const visible = state.pro ? result.subscriptions : result.subscriptions.slice(0, FREE_TIER_LIMIT);
  return {
    source: state.source,
    pro: state.pro,
    summary: result.summary,
    lockedCount: locked ? result.subscriptions.length - FREE_TIER_LIMIT : 0,
    subscriptions: visible.map((s) => ({
      ...s,
      refundEmail: s.flags.refundWindow ? (state.pro ? refundEmail(s) : null) : null
    }))
  };
}

app.get('/api/config', (req, res) => {
  const { state } = getSession(req, res);
  res.json({
    bankConnect: basiq.basiqEnabled() ? 'available' : 'not-configured',
    billing: stripeEnabled() ? 'stripe-test' : 'demo',
    pro: state.pro,
    freeTierLimit: FREE_TIER_LIMIT
  });
});

app.post('/api/statement', upload.single('file'), (req, res) => {
  const { state } = getSession(req, res);
  try {
    const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'No CSV content received' });
    const { transactions, warnings } = parseStatementCsv(text);
    if (!transactions.length) return res.status(400).json({ error: warnings.join(' ') });
    state.transactions = transactions;
    state.source = 'statement';
    res.json({ ok: true, transactionCount: transactions.length, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sample', (req, res) => {
  const { state } = getSession(req, res);
  state.transactions = sampleTransactions();
  state.source = 'sample';
  res.json({ ok: true, transactionCount: state.transactions.length });
});

app.get('/api/analysis', (req, res) => {
  const { state } = getSession(req, res);
  const analysis = analysisFor(state);
  if (!analysis) return res.json({ empty: true });
  res.json(analysis);
});

// ---- Bank connect (Basiq, sandbox-ready) ----
app.post('/api/bank/connect', async (req, res) => {
  const { ssid, state } = getSession(req, res);
  if (!basiq.basiqEnabled()) {
    return res.status(400).json({ error: 'Bank connect is not configured (set BASIQ_API_KEY). Use statement upload instead.' });
  }
  try {
    if (!state.basiqUserId) {
      const user = await basiq.createUser(`subsweep+${ssid.slice(0, 8)}@example.com`);
      state.basiqUserId = user.id;
    }
    const token = await basiq.clientToken(state.basiqUserId);
    res.json({ consentUrl: `https://consent.basiq.io/home?token=${encodeURIComponent(token)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bank/sync', async (req, res) => {
  const { state } = getSession(req, res);
  if (!basiq.basiqEnabled() || !state.basiqUserId) {
    return res.status(400).json({ error: 'No bank connection in this session' });
  }
  try {
    const connections = await basiq.getConnections(state.basiqUserId);
    if (!connections.length) return res.json({ ok: false, reason: 'no-connections' });
    const transactions = await basiq.getTransactions(state.basiqUserId);
    if (!transactions.length) return res.json({ ok: false, reason: 'no-transactions-yet' });
    state.transactions = transactions;
    state.source = 'bank';
    res.json({ ok: true, transactionCount: transactions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Billing (SubSweep Pro) ----
app.post('/api/billing/upgrade', async (req, res) => {
  const { ssid, state } = getSession(req, res);
  try {
    if (stripeEnabled()) {
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const session = await createSubscriptionCheckout({ sessionId: ssid, baseUrl });
      return res.json({ mode: 'stripe-test', checkoutUrl: session.url });
    }
    state.pro = true; // demo mode: simulated upgrade, no card details anywhere
    res.json({ mode: 'demo', pro: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/billing/confirm', async (req, res) => {
  const { ssid, state } = getSession(req, res);
  if (!stripeEnabled()) return res.status(400).json({ error: 'Stripe is not configured' });
  try {
    const session = await retrieveCheckoutSession(String(req.query.checkout_session || ''));
    if (session?.metadata?.appSession !== ssid) return res.status(400).json({ error: 'Session mismatch' });
    if (session.payment_status === 'paid' || session.status === 'complete') {
      state.pro = true;
      return res.json({ pro: true });
    }
    res.json({ pro: false, status: session.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SubSweep (demo) running at http://localhost:${PORT}`);
  console.log(`Bank connect: ${basiq.basiqEnabled() ? 'Basiq configured' : 'not configured (statement upload only)'}`);
  console.log(`Billing: ${stripeEnabled() ? 'Stripe TEST subscriptions' : 'demo (simulated upgrade)'}`);
});
