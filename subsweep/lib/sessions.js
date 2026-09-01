// Signed session cookies (HMAC), no server-side session table for auth.
// SESSION_SECRET should be set in production; a generated secret is
// persisted to the data dir so restarts don't log everyone out in dev.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8');
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}

const SESSION_DAYS = 30;

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  const cookie = `${payload}.${sign(payload)}`;
  return `auth=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return 'auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function readSession(req) {
  const match = (req.headers.cookie || '').match(/auth=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!match) return null;
  const [payload, sig] = match[1].split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || Date.now() > data.exp) return null;
    return data.uid;
  } catch {
    return null;
  }
}
