// Tiny JSON-file order store. Good enough for a demo; swap for a database
// before anything resembling production.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

export function listOrders() {
  return load().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addOrder(order) {
  const orders = load();
  orders.push(order);
  save(orders);
  return order;
}

export function hasOrder(id) {
  return load().some((o) => o.id === id);
}

export function getHoldings() {
  const holdings = new Map();
  for (const o of load()) {
    if (o.status !== 'filled') continue;
    const h = holdings.get(o.ticker) || { ticker: o.ticker, name: o.name, units: 0, cost: 0 };
    h.units += o.units;
    h.cost += o.units * o.unitPrice;
    holdings.set(o.ticker, h);
  }
  return [...holdings.values()].map((h) => ({
    ...h,
    cost: Number(h.cost.toFixed(2)),
    avgPrice: Number((h.cost / h.units).toFixed(3))
  }));
}
