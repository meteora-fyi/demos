import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class RequestError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}
const globals = globalThis;
const secret = process.env.SESSION_SECRET || (globals.__indexSessionSecret ||= randomBytes(32).toString('hex'));
const buckets = globals.__indexRateBuckets ||= new Map();
const active = globals.__indexActiveRequests ||= new Set();
const ttl = 7 * 24 * 60 * 60;
const secure = process.env.NODE_ENV === 'production';
const cookieName = secure ? '__Host-index_session' : 'index_session';
const hmac = text => createHmac('sha256', secret).update(text).digest('base64url');
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function requestSession(req, res) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')));
  let token = cookies[cookieName];
  let [id, expiry, signature] = String(token || '').split('.');
  const valid = /^[a-f0-9]{48}$/.test(id || '') && /^\d{10}$/.test(expiry || '') && Number(expiry) > Date.now() / 1000 && equal(signature, hmac(`${id}.${expiry}`));
  if (!valid) {
    if (req.method === 'POST') throw new RequestError('Your demo session expired. Refresh the page and try again.');
    id = randomBytes(24).toString('hex'); expiry = String(Math.floor(Date.now() / 1000) + ttl);
    token = `${id}.${expiry}.${hmac(`${id}.${expiry}`)}`;
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? '; Secure' : ''}`);
  }
  return { id, csrf: hmac(`csrf:${id}:${expiry}`) };
}
export function authorizeMutation(req, session) {
  const contentType = req.headers['content-type']?.split(';')[0];
  const origin = req.headers.origin;
  const expectedOrigins = [process.env.APP_ORIGIN, ...(process.env.APP_EXTRA_ORIGINS || '').split(',')].filter(Boolean);
  const localOrigin = `http://${req.headers.host}`;
  if (contentType !== 'application/json' || typeof origin !== 'string' || !(expectedOrigins.length ? expectedOrigins : [localOrigin]).includes(origin)) throw new RequestError('Use this app’s same-origin JSON interface.');
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new RequestError('Cross-site requests are not allowed.');
  if (!equal(req.headers['x-csrf-token'], session.csrf)) throw new RequestError('Refresh the page before submitting this action.');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new RequestError('A JSON action is required.', 400);
}
export function throttle(req, sessionId, now = Date.now()) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = process.env.RAILWAY_ENVIRONMENT_ID && typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : req.socket?.remoteAddress || 'unknown';
  const write = req.method === 'POST';
  for (const [key, limit] of [[`session:${sessionId}:${write}`, write ? 45 : 120], [`ip:${ip}:${write}`, write ? 120 : 300]]) {
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > 60000) { bucket = { start: now, count: 0 }; buckets.set(key, bucket); }
    if (++bucket.count > limit) throw new RequestError('Too many requests. Please wait a minute.', 429);
  }
  if (buckets.size > 10000) for (const [key, bucket] of buckets) if (now - bucket.start > 60000) buckets.delete(key);
}
export function admit(sessionId) {
  if (active.has(sessionId) || active.size >= 8) throw new RequestError('The demo is processing transactions. Try again in a moment.', 429);
  active.add(sessionId);
  return () => active.delete(sessionId);
}
