// Basiq (Australian CDR / open banking) integration — sandbox-ready.
//
// Works the moment BASIQ_API_KEY is set (Basiq dashboard -> a sandbox key is
// free and connects to Basiq's simulated "Hooli" test banks; a production key
// requires a CDR representative agreement with Basiq). Without a key the app
// simply reports bank connect as unavailable and statement upload carries v1.
//
// Flow: server token -> create user -> client token (bound to user) ->
// Basiq Consent UI (hosted) -> poll connections -> fetch transactions.

const BASE = 'https://au-api.basiq.io';

let cachedServerToken = null; // { token, expiresAt }

export function basiqEnabled() {
  return Boolean(process.env.BASIQ_API_KEY);
}

async function serverToken() {
  if (cachedServerToken && Date.now() < cachedServerToken.expiresAt) return cachedServerToken.token;
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${process.env.BASIQ_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'basiq-version': '3.0'
    },
    body: 'scope=SERVER_ACCESS'
  });
  if (!res.ok) throw new Error(`Basiq token failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedServerToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedServerToken.token;
}

async function api(method, path, body) {
  const token = await serverToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.data?.[0]?.detail || `Basiq ${method} ${path} failed (${res.status})`);
  return json;
}

export async function createUser(email) {
  return api('POST', '/users', { email });
}

// A CLIENT_ACCESS token bound to the user powers Basiq's hosted Consent UI:
// the frontend opens https://consent.basiq.io/home?token=<clientToken>
export async function clientToken(userId) {
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${process.env.BASIQ_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'basiq-version': '3.0'
    },
    body: `scope=CLIENT_ACCESS&userId=${encodeURIComponent(userId)}`
  });
  if (!res.ok) throw new Error(`Basiq client token failed: ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

export async function getConnections(userId) {
  const json = await api('GET', `/users/${encodeURIComponent(userId)}/connections`);
  return json.data || [];
}

// Fetch all transactions for a user (paginated), mapped to the same shape
// the CSV parser produces: negative amount = money out.
export async function getTransactions(userId) {
  const out = [];
  let path = `/users/${encodeURIComponent(userId)}/transactions?limit=500`;
  for (let page = 0; page < 20 && path; page++) {
    const json = await api('GET', path);
    for (const t of json.data || []) {
      const amount = Number(t.amount);
      if (!Number.isFinite(amount)) continue;
      out.push({
        date: new Date(t.postDate || t.transactionDate),
        description: t.description || '',
        amount: t.direction === 'debit' ? -Math.abs(amount) : Math.abs(amount)
      });
    }
    const next = json.links?.next;
    path = next ? next.replace(BASE, '') : null;
  }
  return out;
}
