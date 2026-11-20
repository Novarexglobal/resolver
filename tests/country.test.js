import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { ROLES, hashPassword } from '../src/auth.js';
import { config, PROVINCES, COUNTRIES, DEFAULT_COUNTRY, provincesOf } from '../src/config.js';
import { validatePost } from '../src/ingest.js';
import { todayISO } from '../src/analysis.js';

const NOW = new Date();
const base = { product: 'Televisor 42"', price: '300', currency: 'USD', province: 'La Habana', published_at: todayISO(NOW), source_url: '' };

test('país: Cuba por defecto; un país fuera del catálogo se rechaza', () => {
  assert.equal(DEFAULT_COUNTRY, 'Cuba');
  assert.equal(COUNTRIES.length >= 1, true);
  assert.equal(validatePost(base, 0, NOW).post.country, 'Cuba');
  const other = validatePost({ ...base, country: 'Venezuela' }, 0, NOW);
  assert.match(other.error.message, /país/);
});

test('provincias: se validan contra el catálogo del país de la publicación', () => {
  assert.equal(provincesOf('Cuba').length, PROVINCES.length);
  assert.deepEqual(provincesOf('Narnia'), []);
  const wrong = validatePost({ ...base, country: 'Cuba', province: 'Caracas' }, 0, NOW);
  assert.match(wrong.error.message, /provincia/);
});

const dir = mkdtempSync(join(tmpdir(), 'resolver-country-'));
const store = new Store(join(dir, 'db.json'));
const server = createServer(createApp(store, { ...config, supabaseUrl: '', supabaseKey: '', resendApiKey: '', mailFrom: '', appUrl: '' }));
let url;
let adminCookie;
let userCookie;

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  store.insert('users', { username: 'comun_1', password_hash: hashPassword('clave-del-comun-1'), role: ROLES.USER, disabled: false });
  const group = store.insert('groups', { name: 'Grupo de Cuba', url: 'https://www.facebook.com/groups/cuba-pais', province: PROVINCES[0], municipality: '', status: 'activo', added_by: 'x' });
  store.insert('posts', { ...base, country: 'Cuba', province: PROVINCES[0], municipality: '', category: 'Otros', category_source: 'sin pista', description: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', group_id: group.id });
  // Publicación de un país que el catálogo no tiene: nunca debe colarse en las búsquedas de Cuba
  store.insert('posts', { ...base, country: 'Venezuela', province: 'Caracas', municipality: '', category: 'Otros', category_source: 'sin pista', description: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', group_id: group.id });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined || ['POST', 'PATCH', 'DELETE'].includes(method)) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

test('la configuración pública lista los países y su valor por defecto', async () => {
  const cfg = await call('GET', '/api/config');
  assert.deepEqual(cfg.json.countries, [{ name: 'Cuba', code: 'CU' }]);
  assert.equal(cfg.json.default_country, 'Cuba');
});

test('la búsqueda por defecto solo muestra publicaciones de Cuba', async () => {
  adminCookie = (await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  userCookie = (await call('POST', '/api/auth/login', { body: { username: 'comun_1', password: 'clave-del-comun-1' } })).cookie;
  const r = await call('GET', '/api/search?q=televisor&days=7', { cookie: userCookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 1);
  assert.equal(r.json.filters.country, 'Cuba');
  assert.ok(r.json.results.every((p) => p.country === 'Cuba'));
});

test('país desconocido en búsqueda, exploración o alta de grupo: 400', async () => {
  assert.equal((await call('GET', '/api/search?q=x&country=Venezuela', { cookie: userCookie })).status, 400);
  assert.equal((await call('GET', '/api/explore?kind=productos&country=Venezuela', { cookie: userCookie })).status, 400);
  const g = await call('POST', '/api/admin/groups', {
    cookie: adminCookie,
    body: { name: 'Grupo de Caracas', url: 'https://www.facebook.com/groups/caracas-x', country: 'Venezuela', province: 'Caracas' },
  });
  assert.equal(g.status, 400);
});

test('grupo de Cuba: el país se guarda y el valor por defecto es Cuba', async () => {
  const g = await call('POST', '/api/admin/groups', {
    cookie: adminCookie,
    body: { name: 'Grupo nuevo de Cuba', url: 'https://www.facebook.com/groups/cuba-nuevo', province: PROVINCES[1], municipality: '' },
  });
  assert.equal(g.status, 201);
  assert.equal(g.json.group.country, 'Cuba');
});
