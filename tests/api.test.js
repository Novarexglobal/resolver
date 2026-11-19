import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { ROLES, hashPassword } from '../src/auth.js';
import { config } from '../src/config.js';

const dir = mkdtempSync(join(tmpdir(), 'resolver-test-'));
const store = new Store(join(dir, 'db.json'));
const server = createServer(createApp(store, { ...config, publicDir: config.publicDir }));
let base;
const ADMIN_PASS = 'clave-del-admin-123';
const USER_PASS = 'clave-del-usuario-1';

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword(ADMIN_PASS), role: ROLES.SUPERADMIN, disabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null, headers: res.headers };
}

let userCookie;
let adminCookie;
let groupId;

test('sin sesión no hay acceso a la búsqueda ni a la administración', async () => {
  assert.equal((await call('GET', '/api/search?days=7')).status, 401);
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
});

test('registro de usuario normal, sin poder crear superadministrador', async () => {
  const r = await call('POST', '/api/auth/register', { body: { username: 'vendedor_1', password: USER_PASS } });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.role, ROLES.USER);
  userCookie = r.cookie;
  const dup = await call('POST', '/api/auth/register', { body: { username: 'vendedor_1', password: USER_PASS } });
  assert.equal(dup.status, 409);
});

test('usuario normal no entra al panel de administración', async () => {
  const r = await call('GET', '/api/admin/overview', { cookie: userCookie });
  assert.equal(r.status, 403);
});

test('inicio de sesión del superadministrador y rechazo de contraseña incorrecta', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: 'equivocada-000' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: ADMIN_PASS } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, ROLES.SUPERADMIN);
  adminCookie = ok.cookie;
});

test('el usuario agrega un grupo de Facebook y solo se aceptan enlaces de Facebook', async () => {
  const bad = await call('POST', '/api/groups', { cookie: userCookie, body: { name: 'Falso', url: 'https://example.com/groups/x' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/api/groups', {
    cookie: userCookie,
    body: { name: 'Compra y venta La Habana', url: 'https://m.facebook.com/groups/ventas-habana/?ref=share' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.group.url, 'https://www.facebook.com/groups/ventas-habana');
  groupId = r.json.group.id;
  const dup = await call('POST', '/api/groups', { cookie: userCookie, body: { name: 'Otra', url: 'https://www.facebook.com/groups/ventas-habana' } });
  assert.equal(dup.status, 409);
});

test('el superadministrador importa publicaciones y las duplicadas se omiten', async () => {
  const csv = [
    'product,price,currency,province,municipality,published_at,description,source_url',
    'iPhone 16,950,USD,La Habana,Playa,2026-11-16,"Nuevo, con caja",https://www.facebook.com/groups/ventas-habana/posts/1',
    'iPhone 16 Pro,1100,USD,La Habana,Plaza de la Revolución,2026-11-17,Usado,https://www.facebook.com/groups/ventas-habana/posts/2',
    'Samsung A15,Mucho,USD,La Habana,Playa,2026-11-16,,',
  ].join('\n');
  const r = await call('POST', '/api/admin/imports', { cookie: adminCookie, body: { group_id: groupId, format: 'csv', content: csv } });
  assert.equal(r.status, 200);
  assert.equal(r.json.inserted, 2);
  assert.equal(r.json.error_count, 1);
  const again = await call('POST', '/api/admin/imports', { cookie: adminCookie, body: { group_id: groupId, format: 'csv', content: csv } });
  assert.equal(again.json.inserted, 0);
  assert.equal(again.json.duplicates, 2);
});

test('el grupo propuesto por el usuario queda como solicitud hasta que el administrador lo activa', async () => {
  const list = await call('GET', '/api/groups', { cookie: userCookie });
  const g = list.json.groups.find((x) => x.id === groupId);
  assert.equal(g.status, 'solicitado');
  // Activar sin provincia no se permite
  const noProv = await call('PATCH', `/api/admin/groups/${groupId}`, { cookie: adminCookie, body: { status: 'activo' } });
  assert.equal(noProv.status, 400);
  const ok = await call('PATCH', `/api/admin/groups/${groupId}`, { cookie: adminCookie, body: { status: 'activo', province: 'La Habana', municipality: 'Playa' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.group.status, 'activo');
  assert.equal(ok.json.group.province, 'La Habana');
});

test('el administrador crea un grupo con provincia y fecha de inicio del historial', async () => {
  const bad = await call('POST', '/api/admin/groups', { cookie: adminCookie, body: { name: 'Sin provincia', url: 'https://www.facebook.com/groups/otro-grupo' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/api/admin/groups', {
    cookie: adminCookie,
    body: { name: 'Teléfonos Matanzas', url: 'https://www.facebook.com/groups/telefonos-matanzas', province: 'Matanzas', created_on: '2019-03-01', history_from: '2019-03-01' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.group.status, 'activo');
  assert.equal(r.json.group.created_on, '2019-03-01');
});

test('las cargas y los grupos no se borran; cada carga queda registrada', async () => {
  const p = await store.list('posts')[0];
  const delPost = await call('DELETE', `/api/admin/posts/${p.id}`, { cookie: adminCookie, body: {} });
  assert.equal(delPost.status, 403);
  assert.equal(store.list('posts').length, 2);
  const delGroup = await call('DELETE', `/api/admin/groups/${groupId}`, { cookie: adminCookie, body: {} });
  assert.equal(delGroup.status, 403);
  const logs = await call('GET', '/api/admin/imports', { cookie: adminCookie });
  assert.equal(logs.json.imports.length, 2);
  assert.equal(logs.json.imports[0].username, 'lemuel');
  const hist = await call('GET', `/api/admin/groups/${groupId}/history`, { cookie: adminCookie });
  assert.equal(hist.status, 200);
  assert.equal(hist.json.total, 2);
  assert.equal(hist.json.imports.length, 2);
  assert.ok(hist.json.monthly.length >= 1);
  assert.equal(hist.json.group.coverage_from, '2026-11-16');
  assert.equal(hist.json.group.coverage_to, '2026-11-17');
  assert.equal(hist.json.group.last_import_day, hist.json.imports[0].day);
});

test('búsqueda con filtros, análisis y trazabilidad a la fuente', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); // hora de Cuba, igual que el servidor
  const r = await call('GET', `/api/search?q=iphone&province=La%20Habana&days=30&end=${today}`, { cookie: userCookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 2);
  assert.ok(r.json.results.every((p) => p.group_url.startsWith('https://www.facebook.com/groups/')));
  assert.equal(r.json.analysis.prices.USD.sufficient, false);
  assert.ok(r.json.analysis.warnings.length > 0);
  const hist = await call('GET', '/api/searches', { cookie: userCookie });
  assert.equal(hist.json.searches.length, 1);
});

test('validaciones de búsqueda: período máximo y provincia desconocida', async () => {
  assert.equal((await call('GET', '/api/search?days=31', { cookie: userCookie })).status, 400);
  assert.equal((await call('GET', '/api/search?province=Narnia', { cookie: userCookie })).status, 400);
});

test('grupo pausado deja de contar en la búsqueda', async () => {
  const p = await call('PATCH', `/api/admin/groups/${groupId}`, { cookie: adminCookie, body: { status: 'pausado' } });
  assert.equal(p.status, 200);
  const r = await call('GET', '/api/search?q=iphone&days=30', { cookie: userCookie });
  assert.equal(r.json.total, 0);
  await call('PATCH', `/api/admin/groups/${groupId}`, { cookie: adminCookie, body: { status: 'activo' } });
});

test('incidencias y cierre de sesión', async () => {
  const r = await call('POST', '/api/reports', { cookie: userCookie, body: { type: 'sugerencia', message: 'Agregar más provincias de análisis' } });
  assert.equal(r.status, 201);
  const out = await call('POST', '/api/auth/logout', { cookie: userCookie, body: {} });
  assert.equal(out.status, 200);
  const me = await call('GET', '/api/me', { cookie: userCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user, null);
});

test('seguridad: escrituras exigen JSON y no hay salida de la carpeta pública', async () => {
  const form = await fetch(base + '/api/groups', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x', });
  assert.equal(form.status, 415);
  const trav = await fetch(base + '/..%2fpackage.json');
  assert.equal(trav.status, 404);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
});

test('carga rápida por líneas desde la API y descarga CSV del historial', async () => {
  const g = store.list('groups').find((x) => x.name === 'Teléfonos Matanzas');
  const lines = 'iPhone 13 | 700 | USD | Matanzas | Cárdenas | 2026-11-15 | Usado, con caja | https://www.facebook.com/groups/telefonos-matanzas/posts/9';
  const r = await call('POST', '/api/admin/imports', { cookie: adminCookie, body: { group_id: g.id, format: 'lines', content: lines } });
  assert.equal(r.status, 200);
  assert.equal(r.json.inserted, 1);
  const logs = await call('GET', '/api/admin/imports', { cookie: adminCookie });
  assert.equal(logs.json.imports[0].format, 'lines');

  const csv = await fetch(`${base}/api/admin/groups/${g.id}/export`, { headers: { Cookie: adminCookie } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="resolver-Telefonos-Matanzas.csv"/);
  const raw = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM UTF-8 para Excel
  const body = raw.subarray(3).toString('utf8');
  assert.match(body, /^published_at,product,price/);
  assert.match(body, /"Usado, con caja"/);
  assert.equal(body.trim().split(/\r\n/).length, 2); // cabecera + 1 publicación
});

test('el administrador restablece la contraseña de un usuario y se cierran sus sesiones', async () => {
  const users = await call('GET', '/api/admin/users', { cookie: adminCookie });
  const vendedor = users.json.users.find((u) => u.username === 'vendedor_1');
  const short = await call('PATCH', `/api/admin/users/${vendedor.id}`, { cookie: adminCookie, body: { password: 'corta' } });
  assert.equal(short.status, 400);
  const ok = await call('PATCH', `/api/admin/users/${vendedor.id}`, { cookie: adminCookie, body: { password: 'nueva-clave-2026' } });
  assert.equal(ok.status, 200);
  const old = await call('POST', '/api/auth/login', { body: { username: 'vendedor_1', password: USER_PASS } });
  assert.equal(old.status, 401);
  const nueva = await call('POST', '/api/auth/login', { body: { username: 'vendedor_1', password: 'nueva-clave-2026' } });
  assert.equal(nueva.status, 200);
});

const todayHavana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('búsqueda por marca y modelo, orden por precio y paginación', async () => {
  // La prueba de cierre de sesión invalidó la cookie anterior: se inicia sesión de nuevo
  const login = await call('POST', '/api/auth/login', { body: { username: 'vendedor_1', password: 'nueva-clave-2026' } });
  assert.equal(login.status, 200);
  userCookie = login.cookie;
  const src = 'https://www.facebook.com/groups/ventas-habana/posts/';
  const rows = [
    { product: 'Samsung A15', brand: 'Samsung', model: 'A15', price: 250, currency: 'USD', province: 'La Habana', municipality: 'Playa', published_at: '2026-11-15', seller: 'Ana M.', seller_contact: '+53 5 555 1234', source_url: src + '50' },
    { product: 'iPhone 13 caja', price: 600, currency: 'USD', province: 'La Habana', municipality: 'Playa', published_at: '2026-11-14', source_url: src + '51' },
    { product: 'Refrigerador Haier', brand: 'Haier', model: 'HRF', price: 40000, currency: 'CUP', province: 'La Habana', municipality: 'Playa', published_at: '2026-11-13', source_url: src + '52' },
  ];
  const imp = await call('POST', '/api/admin/imports', { cookie: adminCookie, body: { group_id: groupId, format: 'json', content: JSON.stringify(rows) } });
  assert.equal(imp.json.inserted, 3);

  const today = todayHavana();
  const byBrand = await call('GET', `/api/search?brand=samsung&days=30&end=${today}`, { cookie: userCookie });
  assert.equal(byBrand.json.total, 1);
  assert.equal(byBrand.json.results[0].seller, 'Ana M.');
  assert.equal(byBrand.json.results[0].seller_contact, '+53 5 555 1234');
  assert.equal((await call('GET', `/api/search?model=HRF&days=30&end=${today}`, { cookie: userCookie })).json.total, 1);

  const searchUrl = `/api/search?province=La%20Habana&days=30&end=${today}&sort=precio_asc`;
  const asc = await call('GET', searchUrl, { cookie: userCookie });
  assert.equal(asc.json.total, 5);
  assert.equal(asc.json.results[0].price, 40000); // CUP primero: no se mezclan monedas
  assert.equal(asc.json.results[1].price, 250);
  assert.ok(asc.json.analysis.warnings.some((w) => /varias monedas/.test(w)));

  const p1 = await call('GET', `${searchUrl}&limit=2`, { cookie: userCookie });
  assert.equal(p1.json.results.length, 2);
  assert.equal(p1.json.next_offset, 2);
  const p3 = await call('GET', `${searchUrl}&limit=2&offset=4`, { cookie: userCookie });
  assert.equal(p3.json.results.length, 1);
  assert.equal(p3.json.next_offset, null);
  assert.equal((await call('GET', '/api/search?sort=raro', { cookie: userCookie })).status, 400);
});

test('panel de inicio con datos reales; usuario nuevo ve estados vacíos', async () => {
  assert.equal((await call('GET', '/api/dashboard')).status, 401);
  const r = await call('GET', '/api/dashboard', { cookie: userCookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.market.posts_total, 6); // 5 de La Habana + 1 de Matanzas, todos de grupos activos
  assert.equal(r.json.market.groups_with_data, 2);
  assert.ok(r.json.recent_searches.length >= 1);
  assert.equal(r.json.activity[0].group_name, 'Compra y venta La Habana');
  assert.ok(Array.isArray(r.json.provinces) && r.json.provinces.length === 2);

  const fresh = await call('POST', '/api/auth/register', { body: { username: 'nuevo.usuario', password: USER_PASS + 'x' } });
  const empty = await call('GET', '/api/dashboard', { cookie: fresh.cookie });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.recent_searches, []);
});

test('la exportación incluye marca, modelo y vendedor cuando existen', async () => {
  const g = store.list('groups').find((x) => x.name === 'Compra y venta La Habana');
  const csv = await fetch(`${base}/api/admin/groups/${g.id}/export`, { headers: { Cookie: adminCookie } });
  const text = Buffer.from(await csv.arrayBuffer()).subarray(3).toString('utf8');
  assert.match(text.split(/\r\n/)[0], /brand,model,seller,seller_contact$/);
  assert.match(text, /\+53 5 555 1234/);
  assert.match(text, /Ana M\./);
});
