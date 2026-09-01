// File-backed user store with atomic writes. Deliberately simple: the
// interface (get/create/update by id or email) is what a Postgres swap
// would reimplement. Raw transactions are NEVER stored — only the account
// record, billing state, and the derived subscription analysis.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    cache = { users: {} };
  }
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, SCRYPT_OPTS);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function findByEmail(email) {
  const db = load();
  const norm = String(email).trim().toLowerCase();
  return Object.values(db.users).find((u) => u.email === norm) || null;
}

export function findById(id) {
  return load().users[id] || null;
}

export function findByStripeCustomer(customerId) {
  return Object.values(load().users).find((u) => u.stripeCustomerId === customerId) || null;
}

export function createUser({ email, password }) {
  const db = load();
  const norm = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm)) throw new Error('Invalid email address');
  if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
  if (findByEmail(norm)) throw new Error('An account with that email already exists');
  const user = {
    id: crypto.randomUUID(),
    email: norm,
    passwordHash: hashPassword(password),
    pro: false,
    stripeCustomerId: null,
    savedAnalysis: null,
    createdAt: new Date().toISOString()
  };
  db.users[user.id] = user;
  save();
  return user;
}

export function updateUser(id, patch) {
  const db = load();
  const user = db.users[id];
  if (!user) return null;
  Object.assign(user, patch);
  save();
  return user;
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, pro: user.pro, hasSavedAnalysis: Boolean(user.savedAnalysis) };
}
