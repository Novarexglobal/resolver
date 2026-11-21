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
import { STYLE_IDS, LOGO_IDS, DEFAULT_VISUAL, normalizeVisual } from '../src/visual.js';
import { ACCENT_COLORS, LOGOS, STYLES, logoMarkup } from '../public/brand.js';
import { onAccentFor } from '../public/visual.js';

// El servidor y el navegador deben conocer exactamente los mismos estilos y logos
test('los identificadores de estilo y logo coinciden entre servidor y navegador', () => {
  assert.deepEqual(STYLES.map((s) => s.id), STYLE_IDS);
  assert.deepEqual(LOGOS.map((l) => l.id), LOGO_IDS);
  assert.equal(STYLE_IDS.length, 10);
  assert.equal(LOGO_IDS.length, 12);
});

test('cada logo se dibuja como SVG, con y sin animación', () => {
  for (const logo of LOGOS) {
    const plain = logoMarkup(logo.id);
    const animated = logoMarkup(logo.id, { animated: true });
    assert.match(plain, /^<svg[^>]*viewBox="0 0 512 512"/, logo.id);
    // Los logos con trazos los dibujan en secuencia; el que solo tiene puntos muestra su nodo al final
    if (logo.items.some((i) => i.p)) assert.match(animated, /class="draw"/, logo.id);
    assert.match(animated, /dot-end/, logo.id);
    assert.doesNotMatch(plain, /class="draw"/, logo.id);
  }
});

test('un logo desconocido cae en el hexágono y no rompe la página', () => {
  assert.equal(logoMarkup('no-existe'), logoMarkup(DEFAULT_VISUAL.logo));
});

test('normalizeVisual usa valores válidos o los de por defecto', () => {
  assert.deepEqual(normalizeVisual({}), DEFAULT_VISUAL);
  assert.deepEqual(normalizeVisual({ visual_style: 'neon', visual_logo: 'radar', visual_accent: '#FF4FD8' }), { style: 'neon', logo: 'radar', accent: '#ff4fd8' });
  assert.deepEqual(normalizeVisual({ visual_style: 'inventado', visual_logo: 'otro', visual_accent: 'rojo' }), DEFAULT_VISUAL);
});

test('el acento por defecto es un color hexadecimal válido y cada color de muestra lo es', () => {
  assert.match(DEFAULT_VISUAL.accent, /^#[0-9a-f]{6}$/);
  for (const hex of ACCENT_COLORS) assert.match(hex, /^#[0-9a-f]{6}$/, hex);
});

test('el texto sobre el acento se lee: oscuro en colores claros, blanco en oscuros', () => {
  assert.equal(onAccentFor('#ffd23f'), '#04121a');
  assert.equal(onAccentFor('#3ee8ff'), '#04121a');
  assert.equal(onAccentFor('#1f3a8a'), '#ffffff');
  assert.equal(onAccentFor('#1f5a3d'), '#ffffff');
});

// ---------- API ----------
const dir = mkdtempSync(join(tmpdir(), 'resolver-visual-'));
const store = new Store(join(dir, 'db.json'));
const server = createServer(createApp(store, { ...config, publicDir: config.publicDir }));
const SUPER_PASS = 'clave-del-admin-123';
const USER_PASS = 'clave-del-usuario-1';
let base;
let superCookie;
let userCookie;

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

before(async () => {
  store.insert('users', { username: 'lemuel', password_hash: hashPassword(SUPER_PASS), role: ROLES.SUPERADMIN, disabled: false });
  store.insert('users', { username: 'vendedor_v', password_hash: hashPassword(USER_PASS), role: ROLES.USER, disabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  superCookie = (await call('POST', '/api/auth/login', { body: { username: 'lemuel', password: SUPER_PASS } })).cookie;
  userCookie = (await call('POST', '/api/auth/login', { body: { username: 'vendedor_v', password: USER_PASS } })).cookie;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('la configuración pública trae el estilo y el logo por defecto', async () => {
  const res = await call('GET', '/api/config');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.visual, DEFAULT_VISUAL);
});

test('solo el superadministrador cambia el estilo y el logo, y se aplican a todos', async () => {
  const denied = await call('PATCH', '/api/admin/settings', { cookie: userCookie, body: { visual_style: 'neon' } });
  assert.equal(denied.status, 403);

  const bad = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_style: 'inventado' } });
  assert.equal(bad.status, 400);
  const badLogo = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_logo: 'inventado' } });
  assert.equal(badLogo.status, 400);

  const ok = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_style: 'neon', visual_logo: 'radar' } });
  assert.equal(ok.status, 200);

  const publicView = await call('GET', '/api/config');
  assert.equal(publicView.json.visual.style, 'neon');
  assert.equal(publicView.json.visual.logo, 'radar');
});

test('el color de acento se valida y se guarda en minúsculas; cualquier estilo acepta cualquier color', async () => {
  const bad = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_accent: 'rojo' } });
  assert.equal(bad.status, 400);
  const badHex = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_accent: '#12345' } });
  assert.equal(badHex.status, 400);

  for (const style of ['papel', 'tinta']) {
    const ok = await call('PATCH', '/api/admin/settings', { cookie: superCookie, body: { visual_style: style, visual_accent: '#1F5A3D' } });
    assert.equal(ok.status, 200);
    const view = await call('GET', '/api/config');
    assert.deepEqual(view.json.visual, { style, logo: 'radar', accent: '#1f5a3d' });
  }
  assert.ok(ACCENT_COLORS.includes('#1f5a3d'));
});
