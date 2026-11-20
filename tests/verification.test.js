import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { ROLES, hashPassword, hashToken, newToken } from '../src/auth.js';
import { config } from '../src/config.js';

const dir = mkdtempSync(join(tmpdir(), 'resolver-verify-'));
const store = new Store(join(dir, 'db.json'));
const sent = [];
let mailOk = true;
const fakeFetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return mailOk ? { ok: true, status: 200 } : { ok: false, status: 500 };
};
const server = createServer(createApp(store, {
  ...config,
  supabaseUrl: '',
  supabaseKey: '',
  resendApiKey: 'clave-de-prueba',
  mailFrom: 'RESOLVER <no-reply@example.com>',
  appUrl: 'https://resolver.example',
  fetchImpl: fakeFetch,
}));
// Segundo servidor sin correo configurado
const storeNoMail = new Store(join(dir, 'sin-correo.json'));
const serverNoMail = createServer(createApp(storeNoMail, { ...config, supabaseUrl: '', supabaseKey: '', resendApiKey: '', mailFrom: '', appUrl: '' }));
let url;
let urlNoMail;
let adminCookie;
let userCookie;

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  storeNoMail.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => serverNoMail.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  urlNoMail = `http://127.0.0.1:${serverNoMail.address().port}`;
});

after(() => {
  server.close();
  serverNoMail.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(root, method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined || ['POST', 'PATCH', 'DELETE'].includes(method)) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(root + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

const tokenFromLastMail = () => {
  const m = sent[sent.length - 1].body.text.match(/verify=([^\s]+)/);
  return decodeURIComponent(m[1]);
};

test('al registrarse con correo se envía el enlace; la cuenta queda sin confirmar', async () => {
  const r = await call(url, 'POST', '/api/auth/register', { body: { username: 'correo_1', email: 'correo1@example.com', password: 'clave-del-usuario-1' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email_verified, false);
  userCookie = r.cookie;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.to[0], 'correo1@example.com');
  assert.match(sent[0].body.text, /https:\/\/resolver\.example\/\?verify=/);
});

test('el enlace confirma el correo una sola vez', async () => {
  const token = tokenFromLastMail();
  const ok = await call(url, 'POST', '/api/auth/verify', { body: { token } });
  assert.equal(ok.status, 200);
  const profile = await call(url, 'GET', '/api/profile', { cookie: userCookie });
  assert.equal(profile.json.user.email_verified, true);
  assert.equal((await call(url, 'POST', '/api/auth/verify', { body: { token } })).status, 400, 'no se reutiliza');
  assert.equal((await call(url, 'POST', '/api/auth/verify', { body: { token: 'inventado' } })).status, 400);
});

test('un enlace caducado no confirma nada', async () => {
  const user = store.get('users', (u) => u.username === 'correo_1');
  const token = newToken();
  store.insert('verifications', { user_id: user.id, email: user.email, token_hash: hashToken(token), expires_at: new Date(Date.now() - 1000).toISOString(), used: false });
  assert.equal((await call(url, 'POST', '/api/auth/verify', { body: { token } })).status, 400);
});

test('cambiar el correo lo deja sin confirmar; el enlace anterior ya no sirve', async () => {
  const oldMail = sent.length;
  const r = await call(url, 'PATCH', '/api/profile', { cookie: userCookie, body: { email: 'correo1-nuevo@example.com' } });
  assert.equal(r.json.user.email_verified, false);
  assert.equal(sent.length, oldMail, 'el cambio no envía solo');
  const user = store.get('users', (u) => u.username === 'correo_1');
  const token = newToken();
  // Enlace emitido para el correo anterior
  store.insert('verifications', { user_id: user.id, email: 'correo1@example.com', token_hash: hashToken(token), expires_at: new Date(Date.now() + 60000).toISOString(), used: false });
  assert.equal((await call(url, 'POST', '/api/auth/verify', { body: { token } })).status, 400);
});

test('reenviar el enlace: máximo tres por hora', async () => {
  const r = await call(url, 'POST', '/api/auth/register', { body: { username: 'reenvio_1', email: 'reenvio@example.com', password: 'clave-del-usuario-4' } });
  const cookie = r.cookie;
  // El registro ya envió uno; se permiten dos reenvíos más en la hora
  const first = await call(url, 'POST', '/api/profile/verify/send', { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.json.sent, true);
  assert.equal((await call(url, 'POST', '/api/profile/verify/send', { cookie })).status, 200);
  const limited = await call(url, 'POST', '/api/profile/verify/send', { cookie });
  assert.equal(limited.status, 429);
});

test('si el servicio de correo falla, el registro sigue y el error queda para el administrador', async () => {
  mailOk = false;
  const r = await call(url, 'POST', '/api/auth/register', { body: { username: 'fallo_1', email: 'fallo@example.com', password: 'clave-del-usuario-5' } });
  assert.equal(r.status, 201, 'el registro no depende del correo');
  mailOk = true;
  const admin = adminCookie || (await call(url, 'POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  adminCookie = admin;
  const errs = await call(url, 'GET', '/api/admin/errors', { cookie: admin });
  assert.ok(errs.json.errors.some((e) => e.kind === 'verificacion' && /servicio de correo|No se pudo/.test(e.message)));
});

test('sin correo configurado: no crea enlaces y lo deja constancia para el administrador', async () => {
  const r = await call(urlNoMail, 'POST', '/api/auth/register', { body: { username: 'sin_correo', email: 'sincorreo@example.com', password: 'clave-del-usuario-2' } });
  assert.equal(r.status, 201);
  const cookie = r.cookie;
  const resend = await call(urlNoMail, 'POST', '/api/profile/verify/send', { cookie });
  assert.equal(resend.status, 200);
  assert.equal(resend.json.sent, false);
  assert.match(resend.json.message, /administrador/);
  assert.equal(storeNoMail.list('verifications').length, 0, 'no se crea ningún enlace sin envío');
  const admin = (await call(urlNoMail, 'POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  const errs = await call(urlNoMail, 'GET', '/api/admin/errors', { cookie: admin });
  assert.ok(errs.json.errors.some((e) => e.kind === 'verificacion'));
});

test('el administrador confirma o corrige el correo de una cuenta desde el panel', async () => {
  adminCookie = (await call(url, 'POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  const user = store.get('users', (u) => u.username === 'correo_1');
  const ok = await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: adminCookie, body: { email_verified: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.email_verified, true);

  const renamed = await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: adminCookie, body: { email: 'corregido@example.com', display_name: 'Ana Pérez' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.user.email, 'corregido@example.com');
  assert.equal(renamed.json.user.email_verified, false, 'un correo corregido se confirma de nuevo');
  assert.equal(renamed.json.user.display_name, 'Ana Pérez');

  assert.equal((await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: adminCookie, body: { email: 'no-es-correo' } })).status, 400);
  assert.equal((await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: adminCookie, body: { email_verified: 'si' } })).status, 400);
});

test('sin correo no se puede confirmar, y los usuarios normales no editan perfiles de otros', async () => {
  const user = store.insert('users', { username: 'sin_mail_admin', email: '', password_hash: hashPassword('clave-del-usuario-3'), role: ROLES.USER, disabled: false });
  assert.equal((await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: adminCookie, body: { email_verified: true } })).status, 400);
  assert.equal((await call(url, 'PATCH', `/api/admin/users/${user.id}`, { cookie: userCookie, body: { email_verified: true } })).status, 403);
});
