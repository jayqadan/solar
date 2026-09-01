import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatementCsv } from './lib/parse.js';
import { detectSubscriptions, refundEmail } from './lib/detect.js';
import { sampleTransactions } from './lib/sample.js';
import * as basiq from './lib/basiq.js';
import * as users from './lib/users.js';
import { createSessionCookie, clearSessionCookie, readSession } from './lib/sessions.js';
import {
  stripeEnabled, refuseLiveKey, ensureCustomer,
  createSubscriptionCheckout, createPortalSession, verifyWebhookSignature
} from './lib/stripe.js';

refuseLiveKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PORT = process.env.PORT || 3100;
const FREE_TIER_LIMIT = 3;

// ---- Stripe webhook FIRST: needs the raw body, before express.json() ----
app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const check = verifyWebhookSignature(req.body.toString('utf8'), req.headers['stripe-signature']);
  if (!check.ok) return res.status(400).json({ error: check.error });
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = event.data?.object || {};
  const userId = obj.metadata?.userId || obj.subscription_details?.metadata?.userId;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  const user = (userId && users.findById(userId)) || (customerId && users.findByStripeCustomer(customerId));

  switch (event.type) {
    case 'checkout.session.completed':
    case 'invoice.paid':
      if (user) users.updateUser(user.id, { pro: true, stripeCustomerId: customerId || user.stripeCustomerId });
      break;
    case 'customer.subscription.deleted':
      if (user) users.updateUser(user.id, { pro: false });
      break;
    case 'customer.subscription.updated':
      if (user) users.updateUser(user.id, { pro: ['active', 'trialing', 'past_due'].includes(obj.status) });
      break;
    default:
      break; // acknowledge everything else
  }
  res.json({ received: true });
});

app.use(express.json());

// ---- Static pages: marketing at /, app at /app ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// ---- Anonymous per-browser working state (transactions stay in memory only,
// for logged-in and anonymous visitors alike) ----
const workspaces = new Map(); // key (user id or anon ssid) -> { transactions, source, basiqUserId, demoPro }

function getContext(req, res) {
  const userId = readSession(req);
  const user = userId ? users.findById(userId) : null;
  let key = user?.id;
  if (!key) {
    const cookie = (req.headers.cookie || '').match(/ssid=([a-f0-9-]{36})/);
    key = cookie?.[1];
    if (!key || !workspaces.has(key)) {
      key = crypto.randomUUID();
      res.setHeader('Set-Cookie', `ssid=${key}; Path=/; HttpOnly; SameSite=Lax`);
    }
  }
  if (!workspaces.has(key)) workspaces.set(key, { transactions: null, source: null, basiqUserId: null, demoPro: false });
  return { user, key, ws: workspaces.get(key) };
}

function isPro(ctx) {
  return ctx.user ? ctx.user.pro : ctx.ws.demoPro;
}

function buildAnalysis(ctx) {
  if (!ctx.ws.transactions?.length) return null;
  const result = detectSubscriptions(ctx.ws.transactions);
  const pro = isPro(ctx);
  const locked = !pro && result.subscriptions.length > FREE_TIER_LIMIT;
  const visible = pro ? result.subscriptions : result.subscriptions.slice(0, FREE_TIER_LIMIT);
  return {
    source: ctx.ws.source,
    pro,
    summary: result.summary,
    lockedCount: locked ? result.subscriptions.length - FREE_TIER_LIMIT : 0,
    subscriptions: visible.map((s) => ({
      ...s,
      refundEmail: s.flags.refundWindow && pro ? refundEmail(s) : null
    }))
  };
}

// ---- Auth ----
app.post('/api/auth/signup', (req, res) => {
  try {
    const user = users.createUser({ email: req.body?.email, password: req.body?.password });
    res.setHeader('Set-Cookie', createSessionCookie(user.id));
    res.json({ user: users.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const user = users.findByEmail(req.body?.email || '');
  if (!user || !users.verifyPassword(req.body?.password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.setHeader('Set-Cookie', createSessionCookie(user.id));
  res.json({ user: users.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const ctx = getContext(req, res);
  res.json({ user: users.publicUser(ctx.user) });
});

// ---- Config ----
app.get('/api/config', (req, res) => {
  const ctx = getContext(req, res);
  res.json({
    bankConnect: basiq.basiqEnabled() ? 'available' : 'not-configured',
    billing: stripeEnabled() ? 'stripe-test' : 'demo',
    pro: isPro(ctx),
    loggedIn: Boolean(ctx.user),
    email: ctx.user?.email || null,
    freeTierLimit: FREE_TIER_LIMIT
  });
});

// ---- Data in ----
app.post('/api/statement', upload.single('file'), (req, res) => {
  const ctx = getContext(req, res);
  try {
    const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'No CSV content received' });
    const { transactions, warnings } = parseStatementCsv(text);
    if (!transactions.length) return res.status(400).json({ error: warnings.join(' ') });
    ctx.ws.transactions = transactions;
    ctx.ws.source = 'statement';
    res.json({ ok: true, transactionCount: transactions.length, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sample', (req, res) => {
  const ctx = getContext(req, res);
  ctx.ws.transactions = sampleTransactions();
  ctx.ws.source = 'sample';
  res.json({ ok: true, transactionCount: ctx.ws.transactions.length });
});

app.get('/api/analysis', (req, res) => {
  const ctx = getContext(req, res);
  const analysis = buildAnalysis(ctx);
  if (!analysis) {
    // Logged-in users get their last saved (derived) analysis back
    if (ctx.user?.savedAnalysis) return res.json({ ...ctx.user.savedAnalysis, restored: true });
    return res.json({ empty: true });
  }
  // Persist the derived analysis (never raw transactions) for account holders
  if (ctx.user) users.updateUser(ctx.user.id, { savedAnalysis: analysis });
  res.json(analysis);
});

// ---- Bank connect (Basiq, sandbox-ready) ----
app.post('/api/bank/connect', async (req, res) => {
  const ctx = getContext(req, res);
  if (!basiq.basiqEnabled()) {
    return res.status(400).json({ error: 'Bank connect is not configured (set BASIQ_API_KEY). Use statement upload instead.' });
  }
  try {
    if (!ctx.ws.basiqUserId) {
      const email = ctx.user?.email || `subsweep+${ctx.key.slice(0, 8)}@example.com`;
      const bUser = await basiq.createUser(email);
      ctx.ws.basiqUserId = bUser.id;
    }
    const token = await basiq.clientToken(ctx.ws.basiqUserId);
    res.json({ consentUrl: `https://consent.basiq.io/home?token=${encodeURIComponent(token)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bank/sync', async (req, res) => {
  const ctx = getContext(req, res);
  if (!basiq.basiqEnabled() || !ctx.ws.basiqUserId) {
    return res.status(400).json({ error: 'No bank connection in this session' });
  }
  try {
    const connections = await basiq.getConnections(ctx.ws.basiqUserId);
    if (!connections.length) return res.json({ ok: false, reason: 'no-connections' });
    const transactions = await basiq.getTransactions(ctx.ws.basiqUserId);
    if (!transactions.length) return res.json({ ok: false, reason: 'no-transactions-yet' });
    ctx.ws.transactions = transactions;
    ctx.ws.source = 'bank';
    res.json({ ok: true, transactionCount: transactions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Billing ----
app.post('/api/billing/upgrade', async (req, res) => {
  const ctx = getContext(req, res);
  try {
    if (stripeEnabled()) {
      if (!ctx.user) return res.status(401).json({ error: 'Create an account first so your subscription has somewhere to live.' });
      const customerId = await ensureCustomer(ctx.user);
      if (customerId !== ctx.user.stripeCustomerId) users.updateUser(ctx.user.id, { stripeCustomerId: customerId });
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const session = await createSubscriptionCheckout({ customerId, userId: ctx.user.id, baseUrl });
      return res.json({ mode: 'stripe-test', checkoutUrl: session.url });
    }
    // Demo mode: simulated upgrade, no card details anywhere
    if (ctx.user) users.updateUser(ctx.user.id, { pro: true });
    else ctx.ws.demoPro = true;
    res.json({ mode: 'demo', pro: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/portal', async (req, res) => {
  const ctx = getContext(req, res);
  if (!stripeEnabled()) return res.status(400).json({ error: 'Stripe is not configured' });
  if (!ctx.user?.stripeCustomerId) return res.status(400).json({ error: 'No billing profile yet' });
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const session = await createPortalSession({ customerId: ctx.user.stripeCustomerId, baseUrl });
    res.json({ portalUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SubSweep running at http://localhost:${PORT}`);
  console.log(`Bank connect: ${basiq.basiqEnabled() ? 'Basiq configured' : 'not configured (statement upload only)'}`);
  console.log(`Billing: ${stripeEnabled() ? 'Stripe TEST subscriptions + webhooks' : 'demo (simulated upgrade)'}`);
});
