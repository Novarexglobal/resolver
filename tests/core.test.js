import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, validatePost, validateBatch } from '../src/ingest.js';
import { resolvePeriod, dedupe, filterPosts, analyze, normalizeText } from '../src/analysis.js';
import { hashPassword, verifyPassword, validatePassword } from '../src/auth.js';
import { canonicalGroupUrl } from '../src/server.js';

const NOW = new Date('2026-11-18T12:00:00-05:00');

const base = {
  product: 'iPhone 16',
  price: '900',
  currency: 'USD',
  province: 'La Habana',
  municipality: 'Playa',
  published_at: '2026-11-10',
  description: 'Nuevo, en caja',
  source_url: '',
};

test('CSV con comillas y punto y coma', () => {
  const rows = parseCSV('product;price;description\n"iPhone 16";900;"Con caja, nuevo"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product, 'iPhone 16');
  assert.equal(rows[0].description, 'Con caja, nuevo');
});

test('validación rechaza provincia fuera de catálogo y fecha futura', () => {
  const bad = validatePost({ ...base, province: 'Narnia', published_at: '2027-01-01' }, 0, NOW);
  assert.ok(bad.error);
  assert.match(bad.error.message, /provincia/);
  assert.match(bad.error.message, /futura/);
});

test('validación acepta Isla de la Juventud y precio con separadores', () => {
  const ok = validatePost({ ...base, province: 'Isla de la Juventud', price: '1.200,50' }, 0, NOW);
  assert.equal(ok.post.price, 1200.5);
});

test('enlace de origen debe ser http(s)', () => {
  const r = validatePost({ ...base, source_url: 'javascript:alert(1)' }, 0, NOW);
  assert.ok(r.error);
});

test('batch separa válidas y errores por fila', () => {
  const { posts, errors } = validateBatch([base, { ...base, price: 'x' }], NOW);
  assert.equal(posts.length, 1);
  assert.equal(errors[0].row, 2);
});

test('período: máximo 30 días y sin fechas futuras', () => {
  const p = resolvePeriod({ end: '2026-11-18', days: 30 }, NOW);
  assert.equal(p.start, '2026-10-20');
  assert.throws(() => resolvePeriod({ end: '2026-11-18', days: 31 }, NOW));
  assert.throws(() => resolvePeriod({ end: '2026-11-30', days: 7 }, NOW));
});

test('deduplicación por enlace y por huella', () => {
  const a = { ...base, group_id: 'g1', source_url: 'https://x.test/1' };
  const { fresh, skipped } = dedupe([a], [a, { ...base, group_id: 'g1' }, { ...base, group_id: 'g1' }]);
  // el primero coincide por enlace existente; el tercero repite la huella del segundo
  assert.equal(skipped.length, 2);
  assert.equal(fresh.length, 1);
});

test('búsqueda por palabras sin acentos', () => {
  const posts = [{ ...base, group_id: 'g1' }];
  assert.equal(filterPosts(posts, { q: 'IPHONE 16' }).length, 1);
  assert.equal(filterPosts(posts, { q: 'samsung' }).length, 0);
  assert.equal(normalizeText('Pinar del Río'), 'pinar del rio');
});

test('análisis: sin datos suficientes no inventa estadísticas', () => {
  const period = resolvePeriod({ end: '2026-11-18', days: 7 }, NOW);
  const res = analyze([{ ...base, group_name: 'G', group_id: 'g1' }], period);
  assert.equal(res.prices.USD.sufficient, false);
  assert.equal(res.prices.USD.avg, null);
  assert.ok(res.warnings.some((w) => /insuficientes/.test(w)));
});

test('análisis: estadísticas y tendencia con datos suficientes', () => {
  const period = resolvePeriod({ end: '2026-11-18', days: 30 }, NOW);
  const posts = [
    { ...base, price: 800, published_at: '2026-11-01', group_name: 'A', group_id: 'g1' },
    { ...base, price: 820, published_at: '2026-11-02', group_name: 'A', group_id: 'g1' },
    { ...base, price: 900, published_at: '2026-11-15', group_name: 'B', group_id: 'g2' },
    { ...base, price: 950, published_at: '2026-11-16', group_name: 'B', group_id: 'g2' },
  ];
  const res = analyze(posts, period);
  assert.equal(res.prices.USD.min, 800);
  assert.equal(res.prices.USD.max, 950);
  assert.equal(res.prices.USD.avg, 867.5);
  assert.equal(res.distribution.byGroup.length, 2);
  assert.ok(res.signals.some((s) => s.type === 'tendencia_precio'));
});

test('contraseñas con scrypt', () => {
  const h = hashPassword('contraseña-segura-1');
  assert.ok(verifyPassword('contraseña-segura-1', h));
  assert.equal(verifyPassword('otra', h), false);
  assert.equal(validatePassword('corta'), false);
});

test('enlaces de grupo: solo Facebook, se normalizan', () => {
  assert.equal(canonicalGroupUrl('https://m.facebook.com/groups/abc123/?ref=x'), 'https://www.facebook.com/groups/abc123');
  assert.throws(() => canonicalGroupUrl('https://example.com/groups/abc'));
  assert.throws(() => canonicalGroupUrl('http://facebook.com/groups/abc'));
  assert.throws(() => canonicalGroupUrl('https://facebook.com/marketplace/x'));
});
