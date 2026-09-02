// Market data provider for the ASX universe.
//
// By default price history is a deterministic simulation (seeded per ticker)
// so the app runs anywhere with no API keys. Set LIVE_DATA=1 to attempt
// fetching real daily closes from Yahoo Finance (.AX symbols); any fetch
// failure falls back silently to the simulated series so the app never breaks.

const UNIVERSE = [
  { ticker: 'BHP', name: 'BHP Group', sector: 'Materials', basePrice: 42.8, drift: 0.05, vol: 0.24 },
  { ticker: 'CBA', name: 'Commonwealth Bank', sector: 'Financials', basePrice: 138.5, drift: 0.06, vol: 0.18 },
  { ticker: 'CSL', name: 'CSL Limited', sector: 'Health Care', basePrice: 295.4, drift: 0.07, vol: 0.22 },
  { ticker: 'NAB', name: 'National Australia Bank', sector: 'Financials', basePrice: 37.2, drift: 0.05, vol: 0.19 },
  { ticker: 'WBC', name: 'Westpac Banking Corp', sector: 'Financials', basePrice: 31.1, drift: 0.04, vol: 0.20 },
  { ticker: 'ANZ', name: 'ANZ Group Holdings', sector: 'Financials', basePrice: 29.6, drift: 0.04, vol: 0.20 },
  { ticker: 'WES', name: 'Wesfarmers', sector: 'Consumer Discretionary', basePrice: 71.9, drift: 0.06, vol: 0.19 },
  { ticker: 'MQG', name: 'Macquarie Group', sector: 'Financials', basePrice: 218.3, drift: 0.07, vol: 0.24 },
  { ticker: 'WOW', name: 'Woolworths Group', sector: 'Consumer Staples', basePrice: 30.4, drift: 0.03, vol: 0.17 },
  { ticker: 'TLS', name: 'Telstra Group', sector: 'Communication Services', basePrice: 4.05, drift: 0.03, vol: 0.15 },
  { ticker: 'FMG', name: 'Fortescue', sector: 'Materials', basePrice: 18.9, drift: 0.04, vol: 0.32 },
  { ticker: 'RIO', name: 'Rio Tinto', sector: 'Materials', basePrice: 112.6, drift: 0.05, vol: 0.25 },
  { ticker: 'GMG', name: 'Goodman Group', sector: 'Real Estate', basePrice: 34.7, drift: 0.08, vol: 0.26 },
  { ticker: 'TCL', name: 'Transurban Group', sector: 'Industrials', basePrice: 13.6, drift: 0.03, vol: 0.16 },
  { ticker: 'WDS', name: 'Woodside Energy', sector: 'Energy', basePrice: 25.3, drift: 0.03, vol: 0.27 },
  { ticker: 'QAN', name: 'Qantas Airways', sector: 'Industrials', basePrice: 9.85, drift: 0.06, vol: 0.30 },
  { ticker: 'XRO', name: 'Xero', sector: 'Information Technology', basePrice: 168.2, drift: 0.09, vol: 0.30 },
  { ticker: 'WTC', name: 'WiseTech Global', sector: 'Information Technology', basePrice: 108.9, drift: 0.10, vol: 0.34 },
  { ticker: 'COL', name: 'Coles Group', sector: 'Consumer Staples', basePrice: 18.7, drift: 0.03, vol: 0.16 },
  { ticker: 'REA', name: 'REA Group', sector: 'Communication Services', basePrice: 236.8, drift: 0.08, vol: 0.27 }
];

const HISTORY_DAYS = 250;
const TRADING_DAYS_PER_YEAR = 252;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller: two uniforms -> one standard normal
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function simulateHistory(stock) {
  const rng = mulberry32(hashSeed(stock.ticker + ':asx'));
  const dt = 1 / TRADING_DAYS_PER_YEAR;
  const closes = [];
  // Start in the past so the series ends near basePrice with realistic wander.
  let price = stock.basePrice * (0.82 + rng() * 0.2);
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const shock = gaussian(rng);
    // Mild mean reversion toward basePrice keeps the sim plausible.
    const reversion = 0.4 * Math.log(stock.basePrice / price) * dt * 10;
    price *= Math.exp((stock.drift - 0.5 * stock.vol * stock.vol) * dt + reversion + stock.vol * Math.sqrt(dt) * shock);
    closes.push(Number(price.toFixed(price > 20 ? 2 : 3)));
  }
  return closes;
}

async function fetchLiveHistory(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.AX?range=1y&interval=1d`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const json = await res.json();
  const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error('Unexpected Yahoo payload');
  const clean = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
  if (clean.length < 60) throw new Error('Insufficient live history');
  return clean.map((c) => Number(c.toFixed(3)));
}

const cache = new Map(); // ticker -> { closes, source, fetchedAt }
const LIVE_TTL_MS = 15 * 60 * 1000;

export async function getHistory(stock) {
  const cached = cache.get(stock.ticker);
  if (cached && (cached.source === 'simulated' || Date.now() - cached.fetchedAt < LIVE_TTL_MS)) {
    return cached;
  }
  if (process.env.LIVE_DATA === '1') {
    try {
      const closes = await fetchLiveHistory(stock.ticker);
      const entry = { closes, source: 'live', fetchedAt: Date.now() };
      cache.set(stock.ticker, entry);
      return entry;
    } catch {
      // fall through to simulation
    }
  }
  const entry = { closes: simulateHistory(stock), source: 'simulated', fetchedAt: Date.now() };
  cache.set(stock.ticker, entry);
  return entry;
}

export function getUniverse() {
  return UNIVERSE;
}

export function getStock(ticker) {
  return UNIVERSE.find((s) => s.ticker === ticker.toUpperCase()) || null;
}
