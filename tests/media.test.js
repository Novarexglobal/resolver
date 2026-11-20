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
import { detectImage, uploadImage, objectPath, MAX_IMAGE_BYTES } from '../src/storage.js';
import { todayISO } from '../src/analysis.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.alloc(32, 3)]);

test('detección de imágenes por bytes, no por el nombre ni la cabecera', () => {
  assert.deepEqual(detectImage(PNG), { type: 'image/png', ext: 'png' });
  assert.deepEqual(detectImage(JPEG), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectImage(WEBP), { type: 'image/webp', ext: 'webp' });
  assert.equal(detectImage(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectImage(Buffer.from([0x89, 0x50])), null);
  assert.equal(detectImage(null), null);
});

test('la ruta de la foto es única por publicación y no sobrescribe', () => {
  const a = objectPath('pub-1', 'png', 'x1');
  const b = objectPath('pub-1', 'png', 'x2');
  assert.notEqual(a, b);
  assert.equal(objectPath('../../etc', 'jpg', 'u'), 'publicaciones/etc-u.jpg');
});

test('subida: sin Supabase no envía nada; con respuesta de error lo informa', async () => {
  const none = await uploadImage({ baseUrl: '', key: '', bucket: 'b', path: 'p.png', bytes: PNG, contentType: 'image/png' });
  assert.equal(none.sent, false);

  const calls = [];
  const ok = await uploadImage({
    baseUrl: 'https://proy.supabase.co/', key: 'k', bucket: 'resolver-fotos', path: 'publicaciones/a.png', bytes: PNG, contentType: 'image/png',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
  });
  assert.equal(ok.sent, true);
  assert.equal(ok.url, 'https://proy.supabase.co/storage/v1/object/public/resolver-fotos/publicaciones/a.png');
  assert.equal(calls[0].url, 'https://proy.supabase.co/storage/v1/object/resolver-fotos/publicaciones/a.png');
  assert.equal(calls[0].init.headers['x-upsert'], 'false', 'nunca sobrescribe');

  const bucket = await uploadImage({
    baseUrl: 'https://proy.supabase.co', key: 'k', bucket: 'resolver-fotos', path: 'p.png', bytes: PNG, contentType: 'image/png',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(bucket.sent, false);
  assert.match(bucket.reason, /404/);
  assert.match(bucket.reason, /resolver-fotos/);

  const down = await uploadImage({
    baseUrl: 'https://proy.supabase.co', key: 'k', bucket: 'b', path: 'p.png', bytes: PNG, contentType: 'image/png',
    fetchImpl: async () => { throw new Error('sin red'); },
  });
  assert.equal(down.sent, false);
});

const dir = mkdtempSync(join(tmpdir(), 'resolver-media-'));
const store = new Store(join(dir, 'db.json'));
const uploads = [];
const fakeFetch = async (url, init) => {
  uploads.push({ url, contentType: init.headers['Content-Type'] });
  return { ok: true, status: 200 };
};
const withStorage = createServer(createApp(store, {
  ...config,
  supabaseUrl: 'https://proy.supabase.co',
  supabaseKey: 'clave-de-servicio',
  imageBucket: 'resolver-fotos',
  fetchImpl: fakeFetch,
  resendApiKey: '',
  mailFrom: '',
  appUrl: '',
}));
const storeNoStorage = new Store(join(dir, 'otro.json'));
const withoutStorage = createServer(createApp(storeNoStorage, { ...config, supabaseUrl: '', supabaseKey: '', resendApiKey: '', mailFrom: '', appUrl: '' }));
let base;
let baseNoStorage;
let adminCookie;
let userCookie;
let postId;

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  storeNoStorage.insert('users', { username: 'lemuel', password_hash: hashPassword('clave-del-admin-123'), role: ROLES.SUPERADMIN, disabled: false });
  await new Promise((r) => withStorage.listen(0, '127.0.0.1', r));
  await new Promise((r) => withoutStorage.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${withStorage.address().port}`;
  baseNoStorage = `http://127.0.0.1:${withoutStorage.address().port}`;
});

after(() => {
  withStorage.close();
  withoutStorage.close();
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

test('foto: se valida por bytes, se sube y queda enlazada a la publicación', async () => {
  adminCookie = (await call(base, 'POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } })).cookie;
  const reg = await call(base, 'POST', '/api/auth/register', { body: { username: 'fotos_1', password: 'clave-del-usuario-1' } });
  userCookie = reg.cookie;

  const group = store.insert('groups', { name: 'Grupo de prueba', url: 'https://www.facebook.com/groups/fotos-test', province: PROVINCES[0], municipality: '', status: 'activo', added_by: 'x' });
  const post = store.insert('posts', {
    product: 'Bicicleta', price: 120, currency: 'USD', province: PROVINCES[0], municipality: '', category: 'Otros', category_source: 'sin pista',
    published_at: todayISO(), description: '', source_url: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', group_id: group.id,
  });
  postId = post.id;

  const r = await call(base, 'POST', `/api/admin/posts/${postId}/image`, { cookie: adminCookie, body: { content_base64: PNG.toString('base64') } });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.post.image_url, /^https:\/\/proy\.supabase\.co\/storage\/v1\/object\/public\/resolver-fotos\/publicaciones\/.+\.png$/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].contentType, 'image/png');
  assert.ok(store.get('posts', (p) => p.id === postId).image_url.length > 0);
});

test('foto: un archivo que no es imagen se rechaza aunque diga ser JPEG', async () => {
  const fake = Buffer.from('<script>alert(1)</script>');
  const r = await call(base, 'POST', `/api/admin/posts/${postId}/image`, { cookie: adminCookie, body: { content_base64: fake.toString('base64'), content_type: 'image/jpeg' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /JPEG, PNG o WebP/);
});

test('foto: más de 2 MB se rechaza y no se sube', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES, 0)]);
  const before = uploads.length;
  const r = await call(base, 'POST', `/api/admin/posts/${postId}/image`, { cookie: adminCookie, body: { content_base64: big.toString('base64') } });
  assert.equal(r.status, 413);
  assert.equal(uploads.length, before);
});

test('foto: sin Supabase configurado responde 503 con el motivo, sin inventar una URL', async () => {
  const sa = await call(baseNoStorage, 'POST', '/api/auth/login', { body: { username: 'lemuel', password: 'clave-del-admin-123' } });
  assert.equal(sa.status, 200);
  const group = storeNoStorage.insert('groups', { name: 'Grupo sin fotos', url: 'https://www.facebook.com/groups/sin-fotos', province: PROVINCES[0], municipality: '', status: 'activo', added_by: 'x' });
  const post = storeNoStorage.insert('posts', { product: 'Mesa', price: 50, currency: 'USD', province: PROVINCES[0], municipality: '', category: 'Otros', category_source: 'sin pista', published_at: todayISO(), description: '', source_url: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', group_id: group.id });
  const r = await call(baseNoStorage, 'POST', `/api/admin/posts/${post.id}/image`, { cookie: sa.cookie, body: { content_base64: PNG.toString('base64') } });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /Supabase Storage configurado/);
  assert.equal(storeNoStorage.get('posts', (p) => p.id === post.id).image_url, '');
});

test('foto: solo el equipo de contenido puede subirla', async () => {
  const r = await call(base, 'POST', `/api/admin/posts/${postId}/image`, { cookie: userCookie, body: { content_base64: PNG.toString('base64') } });
  assert.equal(r.status, 403);
  const anon = await call(base, 'POST', `/api/admin/posts/${postId}/image`, { body: { content_base64: PNG.toString('base64') } });
  assert.equal(anon.status, 401);
});

test('copia de seguridad: completa, sin contraseñas ni sesiones; solo superadministrador', async () => {
  const denied = await call(base, 'GET', '/api/admin/backup', { cookie: userCookie });
  assert.equal(denied.status, 403);

  const raw = await fetch(`${base}/api/admin/backup`, { headers: { Cookie: adminCookie } });
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-disposition'), /resolver-respaldo-\d{4}-\d{2}-\d{2}\.json/);
  const body = await raw.json();
  assert.equal(body.format, 'resolver-backup');
  assert.equal(body.version, 1);
  assert.ok(body.counts.posts >= 1);
  assert.ok(Array.isArray(body.data.groups));
  assert.equal(body.data.sessions, undefined, 'las sesiones no se respaldan');
  assert.equal(body.data.resets, undefined, 'los tokens de recuperación no se respaldan');
  for (const u of body.data.users) assert.equal(u.password_hash, undefined, 'sin contraseñas');
  assert.equal(JSON.stringify(body.data).indexOf('password_hash'), -1);
});

test('documentación OpenAPI: todas las rutas tienen resumen propio', async () => {
  const spec = await (await fetch(`${base}/api/openapi.json`)).json();
  const generic = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (op.summary === `${method.toUpperCase()} ${path}`) generic.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(generic, [], 'faltan resúmenes en OpenAPI');
});
