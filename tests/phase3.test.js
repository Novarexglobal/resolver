import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { ROLES, hashPassword, hashToken, newToken } from '../src/auth.js';
import { config, PROVINCES } from '../src/config.js';
import { classifyPost, categoryScope } from '../src/catalog.js';
import { sendMail } from '../src/mail.js';
import { compareWindows, syncSignals } from '../src/insights.js';
import { buildOpenApi } from '../src/openapi.js';
import { todayISO } from '../src/analysis.js';

const shiftDay = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);

// ---------- Módulos sueltos ----------

test('clasificador: respeta la categoría declarada y marca el origen', () => {
  const known = new Set(['Celulares', 'Otros']);
  const declared = classifyPost({ product: 'Algo', description: '', category: 'Celulares' }, known);
  assert.equal(declared.category, 'Celulares');
  assert.equal(declared.category_source, 'declarada');

  const unknown = classifyPost({ product: 'Algo', description: '', category: 'Cosas raras' }, known);
  assert.equal(unknown.category, 'Otros');
  assert.equal(unknown.category_declared, 'Cosas raras');
  assert.equal(unknown.category_source, 'no reconocida');

  const none = classifyPost({ product: 'zzqx', description: '', category: '' }, known);
  assert.equal(none.category, 'Otros');
  assert.equal(none.category_source, 'sin pista');
});

test('correo: sin clave no envía nada; con respuesta de error lo informa sin inventar éxito', async () => {
  let calls = 0;
  const fake = async () => { calls += 1; return { ok: true }; };
  const off = await sendMail({ apiKey: '', from: '', to: 'a@b.co', subject: 's', text: 't', fetchImpl: fake });
  assert.equal(off.sent, false);
  assert.equal(calls, 0);

  const ok = await sendMail({ apiKey: 'k', from: 'RESOLVER <no-reply@x.co>', to: 'a@b.co', subject: 's', text: 't', fetchImpl: fake });
  assert.equal(ok.sent, true);
  assert.equal(calls, 1);

  const bad = await sendMail({ apiKey: 'k', from: 'f', to: 'a@b.co', subject: 's', text: 't', fetchImpl: async () => ({ ok: false, status: 422 }) });
  assert.equal(bad.sent, false);
  assert.match(bad.reason, /422/);

  const down = await sendMail({ apiKey: 'k', from: 'f', to: 'a@b.co', subject: 's', text: 't', fetchImpl: async () => { throw new Error('sin red'); } });
  assert.equal(down.sent, false);
});

test('comparación entre períodos: solo cambia con datos suficientes en ambos', () => {
  const cur = [100, 110, 120].map((price) => ({ currency: 'USD', price }));
  const prev = [80, 90, 100].map((price) => ({ currency: 'USD', price }));
  const r = compareWindows(cur, prev);
  assert.equal(r.current_total, 3);
  assert.equal(r.previous_total, 3);
  assert.equal(r.currencies.USD.current.sufficient, true);
  assert.equal(typeof r.currencies.USD.median_change_pct, 'number');

  const thin = compareWindows([{ currency: 'CUP', price: 5 }], []);
  assert.equal(thin.currencies.CUP.median_change_pct, null);
});

test('categoryScope incluye las subcategorías de una categoría principal', () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'resolver-scope-')), 'db.json'));
  store.insert('categories', { name: 'Hogar', parent: null, active: true });
  store.insert('categories', { name: 'Cocina', parent: 'Hogar', active: true });
  store.insert('categories', { name: 'Jardín', parent: 'Hogar', active: false });
  assert.deepEqual(categoryScope(store, 'Hogar').sort(), ['Cocina', 'Hogar']);
  assert.equal(categoryScope(store, ''), null);
});

test('sincronizar señales no duplica las que ya existen', () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'resolver-sig-')), 'db.json'));
  const now = new Date();
  const first = syncSignals(store, [], now);
  const second = syncSignals(store, [], now);
  assert.equal(first.created, 0);
  assert.equal(second.created, 0);
  assert.equal(store.list('signals').length, 0);
});

test('OpenAPI se genera desde las rutas registradas con parámetros en formato OpenAPI', () => {
  const doc = buildOpenApi([
    { method: 'GET', path: '/api/search' },
    { method: 'DELETE', path: '/api/admin/groups/:id' },
  ]);
  assert.equal(doc.openapi, '3.0.3');
  assert.match(doc.paths['/api/search'].get.summary, /Buscar publicaciones/);
  assert.ok(doc.paths['/api/admin/groups/{id}'].delete);
  assert.deepEqual(doc.paths['/api/admin/groups/{id}'].delete.tags, ['admin']);
});

// ---------- API ----------

const dir = mkdtempSync(join(tmpdir(), 'resolver-phase3-'));
const store = new Store(join(dir, 'db.json'));
// Sin correo configurado: la recuperación debe responder igual y dejar constancia en errores
const server = createServer(createApp(store, { ...config, resendApiKey: '', mailFrom: '', appUrl: '' }));
let base;
const ADMIN_PASS = 'clave-del-admin-123';
const USER_PASS = 'clave-del-usuario-1';
const GROUP_URL = 'https://www.facebook.com/groups/resolver-test-habana';

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
  // Toda escritura declara JSON, también las que no llevan cuerpo (el servidor lo exige)
  if (body !== undefined || ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

let adminCookie;
let userCookie;
let userCookie2;
let modCookie;
let groupId;
let searchIds = [];

test('información pública: módulos, Sobre RESOLVER, configuración y OpenAPI', async () => {
  const info = await call('GET', '/api/info');
  assert.equal(info.status, 200);
  assert.equal(info.json.modules.buscar.title, 'Encuéntralo');
  assert.equal(info.json.about.slogan, 'Lo encuentras. Compras. Resuelves.');

  const cfg = await call('GET', '/api/config');
  assert.ok(Array.isArray(cfg.json.category_tree) && cfg.json.category_tree.length > 0);
  assert.ok(cfg.json.category_tree.every((c) => Array.isArray(c.children)));
  assert.equal(cfg.json.default_days, 7);
  assert.ok(Array.isArray(cfg.json.plans));

  const spec = await call('GET', '/api/openapi.json');
  assert.equal(spec.json.openapi, '3.0.3');
  assert.ok(spec.json.paths['/api/search'].get);
});

test('perfil: nombre, preferencias validadas y correo único', async () => {
  const r = await call('POST', '/api/auth/register', { body: { username: 'perfil_1', email: 'perfil@example.com', password: USER_PASS } });
  assert.equal(r.status, 201);
  userCookie = r.cookie;

  const dupEmail = await call('POST', '/api/auth/register', { body: { username: 'perfil_2', email: 'perfil@example.com', password: USER_PASS } });
  assert.equal(dupEmail.status, 409);

  const ok = await call('PATCH', '/api/profile', { cookie: userCookie, body: { display_name: 'Ana Pérez', preferences: { theme: 'oscuro', default_days: 14 } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.preferences.theme, 'oscuro');
  assert.equal(ok.json.user.preferences.default_days, 14);

  assert.equal((await call('PATCH', '/api/profile', { cookie: userCookie, body: { preferences: { theme: 'rosa' } } })).status, 400);
  assert.equal((await call('PATCH', '/api/profile', { cookie: userCookie, body: { preferences: { default_province: 'Atlántida' } } })).status, 400);
  assert.equal((await call('PATCH', '/api/profile', { cookie: userCookie, body: { email: 'no-es-correo' } })).status, 400);
});

test('sesiones y cambio de contraseña: se cierran las demás sesiones, no la actual', async () => {
  userCookie2 = (await call('POST', '/api/auth/login', { body: { username: 'perfil_1', password: USER_PASS } })).cookie;
  assert.ok(userCookie2);

  const list = await call('GET', '/api/profile/sessions', { cookie: userCookie });
  assert.ok(list.json.sessions.length >= 2);
  assert.equal(list.json.sessions.filter((s) => s.current).length, 1);

  assert.equal((await call('POST', '/api/profile/password', { cookie: userCookie, body: { current: 'mal', password: 'clave-nueva-2026' } })).status, 400);
  assert.equal((await call('POST', '/api/profile/password', { cookie: userCookie, body: { current: USER_PASS, password: 'corta' } })).status, 400);
  assert.equal((await call('POST', '/api/profile/password', { cookie: userCookie, body: { current: USER_PASS, password: 'clave-nueva-2026' } })).status, 200);

  assert.equal((await call('GET', '/api/profile', { cookie: userCookie2 })).status, 401);
  assert.equal((await call('GET', '/api/profile', { cookie: userCookie })).status, 200);
  assert.equal((await call('DELETE', '/api/profile/sessions/no-existe', { cookie: userCookie })).status, 404);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'perfil_1', password: 'clave-nueva-2026' } })).status, 200);
  const relogin = await call('POST', '/api/auth/login', { body: { username: 'perfil_1', password: 'clave-nueva-2026' } });
  userCookie = relogin.cookie;
});

test('recuperación: respuesta genérica sin correo configurado y enlace de un solo uso', async () => {
  const generic = await call('POST', '/api/auth/forgot', { body: { email: 'perfil@example.com' } });
  assert.equal(generic.status, 200);
  assert.equal(generic.json.ok, true);
  const unknown = await call('POST', '/api/auth/forgot', { body: { email: 'nadie@example.com' } });
  assert.equal(unknown.json.message, generic.json.message, 'no revela qué correos existen');
  assert.equal((await call('POST', '/api/auth/forgot', { body: { email: 'mal' } })).status, 400);

  adminCookie = (await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: ADMIN_PASS } })).cookie;
  const errs = await call('GET', '/api/admin/errors', { cookie: adminCookie });
  assert.ok(errs.json.errors.some((e) => e.kind === 'recuperacion'), 'queda constancia para el administrador');

  const user = store.get('users', (u) => u.username === 'perfil_1');
  const token = newToken();
  store.insert('resets', { user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 60_000).toISOString(), used: false });
  const reset = await call('POST', '/api/auth/reset', { body: { token, password: 'clave-recuperada-1' } });
  assert.equal(reset.status, 200);
  assert.equal((await call('POST', '/api/auth/reset', { body: { token, password: 'clave-recuperada-2' } })).status, 400, 'no se reutiliza');
  assert.equal((await call('GET', '/api/profile', { cookie: userCookie })).status, 401, 'la recuperación cierra las sesiones');
  userCookie = (await call('POST', '/api/auth/login', { body: { username: 'perfil_1', password: 'clave-recuperada-1' } })).cookie;
});

test('recuperación: enlace caducado no sirve', async () => {
  const user = store.get('users', (u) => u.username === 'perfil_1');
  const token = newToken();
  store.insert('resets', { user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() - 1000).toISOString(), used: false });
  const r = await call('POST', '/api/auth/reset', { body: { token, password: 'clave-caducada-1' } });
  assert.equal(r.status, 400);
});

test('roles: el moderador gestiona contenido, pero no configuración, estadísticas ni usuarios', async () => {
  const reg = await call('POST', '/api/auth/register', { body: { username: 'moderador_1', password: USER_PASS } });
  const modId = store.get('users', (u) => u.username === 'moderador_1').id;

  assert.equal((await call('PATCH', `/api/admin/users/${modId}`, { cookie: adminCookie, body: { role: ROLES.SUPERADMIN } })).status, 400);
  const promoted = await call('PATCH', `/api/admin/users/${modId}`, { cookie: adminCookie, body: { role: ROLES.MODERATOR } });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.json.user.role, 'moderador');

  modCookie = (await call('POST', '/api/auth/login', { body: { username: 'moderador_1', password: USER_PASS } })).cookie;
  assert.equal((await call('GET', '/api/admin/groups', { cookie: modCookie })).status, 200);
  assert.equal((await call('GET', '/api/admin/overview', { cookie: modCookie })).json.role, 'moderador');
  assert.equal((await call('GET', '/api/admin/stats', { cookie: modCookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/errors', { cookie: modCookie })).status, 403);
  assert.equal((await call('PATCH', '/api/admin/settings', { cookie: modCookie, body: { announcement: 'hola' } })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/users/${modId}`, { cookie: modCookie, body: { disabled: true } })).status, 403);
  assert.ok(reg.cookie);
});

test('grupo, carga y búsqueda con análisis, comparación y guardados', async () => {
  const g = await call('POST', '/api/admin/groups', {
    cookie: adminCookie,
    body: { name: 'Compra y venta La Habana', url: GROUP_URL, province: PROVINCES[0], municipality: 'Playa' },
  });
  assert.equal(g.status, 201);
  groupId = g.json.group.id;

  const today = todayISO();
  const rows = [
    { product: 'iPhone 13 128GB', price: 500, currency: 'USD', province: PROVINCES[0], municipality: 'Playa', published_at: shiftDay(today, -1), description: 'Apple iPhone 13 en buen estado', seller: 'Vendedor A', seller_contact: '5555-0000' },
    { product: 'iPhone 13 128GB', price: 520, currency: 'USD', province: PROVINCES[0], municipality: 'Playa', published_at: shiftDay(today, -2), description: 'iPhone 13 con caja' },
    { product: 'iPhone 13 128GB', price: 480, currency: 'USD', province: PROVINCES[0], municipality: 'Playa', published_at: shiftDay(today, -3), description: 'iPhone 13' },
    { product: 'iPhone 13 128GB', price: 510, currency: 'USD', province: PROVINCES[0], municipality: 'Playa', published_at: shiftDay(today, -4), description: 'iPhone 13 batería 90%' },
    { product: 'Lavadora automática', price: 300000, currency: 'CUP', province: PROVINCES[0], municipality: 'Playa', published_at: shiftDay(today, -1), description: 'Lavadora de 7 kg' },
  ];
  const imp = await call('POST', '/api/admin/imports', { cookie: adminCookie, body: { group_id: groupId, format: 'json', content: JSON.stringify(rows) } });
  assert.equal(imp.status, 200);
  assert.equal(imp.json.inserted, 5);

  const s1 = await call('GET', '/api/search?q=iphone&days=7', { cookie: userCookie });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.total, 4);
  assert.ok(Number.isInteger(s1.json.search_id) || typeof s1.json.search_id === 'string', 'la primera página devuelve el identificador para guardar');
  assert.equal(s1.json.analysis.prices.USD.sufficient, true);
  assert.ok(Array.isArray(s1.json.analysis.municipalities));
  assert.ok(s1.json.comparison && typeof s1.json.comparison.total === 'number');
  assert.equal(s1.json.results[0].seller, 'Vendedor A');

  assert.equal((await call('GET', '/api/search?q=iphone&category=Inventada', { cookie: userCookie })).status, 400);

  const s2 = await call('GET', '/api/search?q=lavadora&days=7', { cookie: userCookie });
  assert.equal(s2.json.total, 1);

  const hist = await call('GET', '/api/searches', { cookie: userCookie });
  searchIds = hist.json.searches.map((s) => s.id);
  assert.ok(searchIds.length >= 2);

  const cmp = await call('GET', `/api/searches/compare?a=${searchIds[0]}&b=${searchIds[1]}`, { cookie: userCookie });
  assert.equal(cmp.status, 200);
  assert.ok(cmp.json.currencies && typeof cmp.json.currencies === 'object');
  assert.equal((await call('GET', `/api/searches/compare?a=${searchIds[0]}&b=nope`, { cookie: userCookie })).status, 404);

  const save = await call('POST', '/api/saves', { cookie: userCookie, body: { kind: 'analysis', ref_id: searchIds[0] } });
  assert.equal(save.status, 201);
  assert.ok(save.json.save.snapshot.summary, 'el análisis se copia desde el registro original');
  assert.equal((await call('POST', '/api/saves', { cookie: userCookie, body: { kind: 'analysis', ref_id: searchIds[0] } })).status, 409);
  assert.equal((await call('POST', '/api/saves', { cookie: userCookie, body: { kind: 'signal', ref_id: 'nope' } })).status, 404);
  const saves = await call('GET', '/api/saves', { cookie: userCookie });
  assert.equal(saves.json.saves.length, 1);
  assert.equal((await call('DELETE', `/api/saves/${save.json.save.id}`, { cookie: userCookie })).status, 200);

  // Otro usuario no ve ni guarda búsquedas ajenas
  assert.equal((await call('GET', `/api/searches/compare?a=${searchIds[0]}&b=${searchIds[1]}`, { cookie: modCookie })).status, 404);
});

test('exploración: cada vista responde y las no válidas se rechazan', async () => {
  const base = '/api/explore?days=30';
  for (const kind of ['productos', 'categorias', 'publicaciones', 'presencia', 'provincias', 'movimientos', 'oportunidades']) {
    const r = await call('GET', `${base}&kind=${kind}`, { cookie: userCookie });
    assert.equal(r.status, 200, kind);
    assert.equal(r.json.kind, kind);
  }
  assert.equal((await call('GET', `${base}&kind=municipios`, { cookie: userCookie })).status, 400, 'municipios exige provincia');
  const mun = await call('GET', `${base}&kind=municipios&province=${encodeURIComponent(PROVINCES[0])}`, { cookie: userCookie });
  assert.equal(mun.status, 200);
  assert.equal((await call('GET', `${base}&kind=inventada`, { cookie: userCookie })).status, 400);
});

test('señales: se sincronizan, se listan y el administrador puede retirarlas', async () => {
  const sync = await call('POST', '/api/admin/signals/sync', { cookie: modCookie });
  assert.equal(sync.status, 200);
  assert.equal(typeof sync.json.candidates, 'number');
  const list = await call('GET', '/api/signals', { cookie: userCookie });
  assert.equal(list.status, 200);
  const signal = store.list('signals')[0];
  if (signal) {
    assert.equal((await call('PATCH', `/api/admin/signals/${signal.id}`, { cookie: modCookie, body: { status: 'retirada' } })).status, 200);
    const after2 = await call('GET', '/api/signals', { cookie: userCookie });
    assert.ok(!after2.json.signals.some((s) => s.id === signal.id));
  }
  assert.equal((await call('PATCH', '/api/admin/signals/x', { cookie: modCookie, body: { status: 'borrada' } })).status, 400);
});

test('categorías: se añaden y desactivan, nunca se eliminan', async () => {
  const root = store.list('categories', (c) => c.parent === null)[0];
  const created = await call('POST', '/api/admin/categories', { cookie: modCookie, body: { name: 'Consolas de juego', parent: root.name } });
  assert.equal(created.status, 201);
  assert.equal((await call('POST', '/api/admin/categories', { cookie: modCookie, body: { name: 'Consolas de juego', parent: root.name } })).status, 409);
  assert.equal((await call('POST', '/api/admin/categories', { cookie: modCookie, body: { name: 'Otra cosa', parent: 'No existe' } })).status, 400);

  const off = await call('PATCH', `/api/admin/categories/${created.json.category.id}`, { cookie: modCookie, body: { active: false } });
  assert.equal(off.status, 200);
  const cfg = await call('GET', '/api/config');
  assert.ok(!cfg.json.categories.includes('Consolas de juego'));
  assert.equal((await call('DELETE', `/api/admin/categories/${created.json.category.id}`, { cookie: modCookie })).status, 403);
});

test('fuentes: ninguna aparece conectada sin adaptador real', async () => {
  const created = await call('POST', '/api/admin/sources', { cookie: modCookie, body: { key: 'mercado-x', name: 'Mercado X (pendiente)', note: 'Sin acuerdo.' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.source.status, 'no conectada');
  assert.equal((await call('POST', '/api/admin/sources', { cookie: modCookie, body: { key: 'Mal Key', name: 'Nombre válido' } })).status, 400);

  const fake = await call('PATCH', `/api/admin/sources/${created.json.source.id}`, { cookie: modCookie, body: { status: 'activa' } });
  assert.equal(fake.status, 400, 'no se puede marcar activa sin adaptador');
  const manual = store.get('sources', (s) => s.key === 'facebook-manual');
  assert.equal((await call('PATCH', `/api/admin/sources/${manual.id}`, { cookie: modCookie, body: { status: 'pausada' } })).status, 200);
  assert.equal((await call('PATCH', `/api/admin/sources/${manual.id}`, { cookie: modCookie, body: { status: 'activa' } })).status, 200);
});

test('configuración: el aviso llega a la app; solo el superadministrador la cambia', async () => {
  assert.equal((await call('PATCH', '/api/admin/settings', { cookie: adminCookie, body: { default_days: 5 } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/settings', { cookie: adminCookie, body: { announcement: 'Mantenimiento el sábado' } })).status, 200);
  const cfg = await call('GET', '/api/config');
  assert.equal(cfg.json.announcement, 'Mantenimiento el sábado');
});

test('reportes: reclamación válida, tipo desconocido rechazado, moderador lo cierra', async () => {
  const r = await call('POST', '/api/reports', { cookie: userCookie, body: { type: 'reclamacion', message: 'El precio mostrado no coincide con la publicación.' } });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/api/reports', { cookie: userCookie, body: { type: 'otro', message: 'Mensaje suficientemente largo' } })).status, 400);
  const list = await call('GET', '/api/admin/reports', { cookie: modCookie });
  const id = list.json.reports[0].id;
  assert.equal((await call('PATCH', `/api/admin/reports/${id}`, { cookie: modCookie, body: { status: 'cerrado' } })).status, 200);
});

test('nada se borra: grupos, publicaciones y categorías responden 403', async () => {
  const post = store.list('posts')[0];
  assert.equal((await call('DELETE', `/api/admin/groups/${groupId}`, { cookie: adminCookie })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/posts/${post.id}`, { cookie: adminCookie })).status, 403);
  assert.equal((await call('DELETE', `/api/searches/${searchIds[0]}`, { cookie: userCookie })).status, 200, 'el historial propio sí se puede quitar');
});

test('paneles de administración: historial, exportación, estadísticas y supervisión', async () => {
  const history = await call('GET', `/api/admin/groups/${groupId}/history`, { cookie: modCookie });
  assert.equal(history.status, 200);
  assert.equal(history.json.total, 5);
  assert.ok(Array.isArray(history.json.monthly));

  // Se leen los bytes crudos: text() quitaría el BOM que Excel necesita
  const raw = await fetch(`${base}/api/admin/groups/${groupId}/export`, { headers: { Cookie: adminCookie } });
  assert.equal(raw.status, 200);
  const bytes = Buffer.from(await raw.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para Excel');
  assert.match(bytes.subarray(3).toString('utf8').split('\r\n')[0], /^published_at,product,price/);

  const stats = await call('GET', '/api/admin/stats', { cookie: adminCookie });
  assert.equal(stats.status, 200);
  assert.ok(stats.json.users.total >= 3);

  const sup = await call('GET', '/api/admin/searches', { cookie: modCookie });
  assert.equal(sup.status, 200);
  assert.ok(sup.json.searches.some((s) => s.username === 'perfil_1'));

  const cats = await call('GET', '/api/admin/categories', { cookie: modCookie });
  assert.ok(Array.isArray(cats.json.tree));
});
