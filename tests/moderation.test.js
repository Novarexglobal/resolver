import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { ROLES, hashPassword } from '../src/auth.js';
import { config, PROVINCES } from '../src/config.js';
import { todayISO } from '../src/analysis.js';

const dir = mkdtempSync(join(tmpdir(), 'resolver-mod-'));
const store = new Store(join(dir, 'db.json'));
const server = createServer(createApp(store, { ...config, supabaseUrl: '', supabaseKey: '', resendApiKey: '', mailFrom: '', appUrl: '' }));
let base;
let adminCookie;
let modCookie;
let userCookie;
let postIds = [];
let groupId;

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  store.insert('users', { username: 'moder_1', password_hash: hashPassword('clave-del-moder-1'), role: ROLES.MODERATOR, disabled: false });
  store.insert('users', { username: 'comun_1', password_hash: hashPassword('clave-del-comun-1'), role: ROLES.USER, disabled: false });
  const group = store.insert('groups', { name: 'Grupo moderación', url: 'https://www.facebook.com/groups/moderacion', province: PROVINCES[0], municipality: '', status: 'activo', added_by: 'x' });
  groupId = group.id;
  for (const price of [500, 520, 480]) {
    const p = store.insert('posts', {
      product: 'iPhone 13 128GB', price, currency: 'USD', province: PROVINCES[0], municipality: '', category: 'Otros', category_source: 'sin pista',
      published_at: todayISO(), description: `iPhone 13 ${price}`, source_url: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', group_id: group.id,
    });
    postIds.push(p.id);
  }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined || ['POST', 'PATCH', 'DELETE'].includes(method)) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

test('antes de ocultar, las tres publicaciones cuentan en la búsqueda', async () => {
  adminCookie = (await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  modCookie = (await call('POST', '/api/auth/login', { body: { username: 'moder_1', password: 'clave-del-moder-1' } })).cookie;
  userCookie = (await call('POST', '/api/auth/login', { body: { username: 'comun_1', password: 'clave-del-comun-1' } })).cookie;
  const r = await call('GET', '/api/search?q=iphone&days=7', { cookie: userCookie });
  assert.equal(r.json.total, 3);
});

test('ocultar exige motivo y solo lo hace el equipo de contenido', async () => {
  assert.equal((await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: userCookie, body: { hidden: true, reason: 'solicitud del grupo' } })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: modCookie, body: { hidden: true } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: modCookie, body: { hidden: true, reason: 'abc' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: modCookie, body: { reason: 'sin campo' } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/posts/no-existe', { cookie: modCookie, body: { hidden: true, reason: 'motivo válido' } })).status, 404);
});

test('una publicación oculta sale de búsquedas e inicio, pero no se borra', async () => {
  const r = await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: modCookie, body: { hidden: true, reason: 'El grupo pidió retirarla' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.post.hidden, true);
  assert.equal(r.json.post.hidden_reason, 'El grupo pidió retirarla');

  const search = await call('GET', '/api/search?q=iphone&days=7', { cookie: userCookie });
  assert.equal(search.json.total, 2);
  assert.ok(!search.json.results.some((p) => p.id === postIds[0]));

  assert.equal(store.list('posts').length, 3, 'nada se borra');
  assert.equal(store.get('posts', (p) => p.id === postIds[0]).hidden, true);
});

test('la lista del panel muestra la publicación oculta con su motivo', async () => {
  const list = await call('GET', `/api/admin/posts?group_id=${groupId}`, { cookie: modCookie });
  const row = list.json.posts.find((p) => p.id === postIds[0]);
  assert.equal(row.hidden, true);
  assert.equal(row.hidden_reason, 'El grupo pidió retirarla');
});

test('la publicación oculta no se vuelve a cargar al repetir la importación', async () => {
  const again = await call('POST', '/api/admin/posts', {
    cookie: adminCookie,
    body: { group_id: groupId, product: 'iPhone 13 128GB', price: 500, currency: 'USD', province: PROVINCES[0], municipality: '', published_at: todayISO(), description: 'iPhone 13 500', source_url: '' },
  });
  assert.equal(again.status, 409);
});

test('mostrarla de nuevo la devuelve a las búsquedas y conserva el registro', async () => {
  const r = await call('PATCH', `/api/admin/posts/${postIds[0]}`, { cookie: modCookie, body: { hidden: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.post.hidden, false);
  const search = await call('GET', '/api/search?q=iphone&days=7', { cookie: userCookie });
  assert.equal(search.json.total, 3);
  const stored = store.get('posts', (p) => p.id === postIds[0]);
  assert.equal(stored.hidden_by, 'moder_1', 'queda quién la ocultó');
  assert.equal(stored.hidden, false);
});
