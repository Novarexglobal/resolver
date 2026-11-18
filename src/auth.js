import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const ROLES = { SUPERADMIN: 'superadmin', USER: 'user' };

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function validateUsername(username) {
  return typeof username === 'string' && /^[a-z0-9_.-]{3,30}$/.test(username);
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 200;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function createSession(store, userId, days) {
  const token = randomBytes(32).toString('base64url');
  const expires_at = new Date(Date.now() + days * 864e5).toISOString();
  // Solo se guarda el hash del token: si se filtra la base, no sirve para entrar.
  store.insert('sessions', { token_hash: sha256(token), user_id: userId, expires_at });
  return { token, expires_at };
}

export function getUserFromRequest(store, req) {
  const token = parseCookies(req.headers.cookie).resolver_session;
  if (!token) return null;
  const session = store.get('sessions', (s) => s.token_hash === sha256(token));
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    store.remove('sessions', session.id);
    return null;
  }
  const user = store.get('users', (u) => u.id === session.user_id);
  if (!user || user.disabled) return null;
  return user;
}

export function destroySession(store, req) {
  const token = parseCookies(req.headers.cookie).resolver_session;
  if (!token) return;
  const session = store.get('sessions', (s) => s.token_hash === sha256(token));
  if (session) store.remove('sessions', session.id);
}

export function sessionCookie(token, expires_at, secure) {
  const parts = [
    `resolver_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expires_at).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return 'resolver_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

// Límite de intentos de inicio de sesión: 8 fallos por IP+usuario cada 15 minutos.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginAllowed(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) return true;
  return entry.count < MAX_ATTEMPTS;
}

export function recordFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else entry.count += 1;
}

export function clearFailures(key) {
  attempts.delete(key);
}
