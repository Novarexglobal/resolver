import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, validatePost, validateBatch } from '../src/ingest.js';
import { resolvePeriod, dedupe, filterPosts, analyze, normalizeText, sortPosts, buildDashboard } from '../src/analysis.js';
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

test('carga rápida por líneas: 8 campos, vacíos permitidos, errores por línea', async () => {
  const { parseLines, validateBatch } = await import('../src/ingest.js');
  const rows = parseLines([
    '# comentario ignorado',
    'iPhone 16 | 950 | USD | La Habana | Playa | 2026-11-16 | Nuevo con caja | https://www.facebook.com/groups/x/posts/1',
    'Samsung A15 | 250 |  | Matanzas |  | 2026-11-16 |  | ',
    'mal | línea',
  ].join('\n'));
  assert.equal(rows.length, 3);
  const { posts, errors } = validateBatch(rows, NOW);
  assert.equal(posts.length, 2);
  assert.equal(posts[1].currency, 'CUP');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /8 campos/);
});

test('marca, modelo y vendedor son opcionales y se guardan solo si vienen', () => {
  const ok = validatePost({ ...base, brand: 'Apple', model: 'iPhone 16', seller: 'Ana M.' }, 0, NOW);
  assert.equal(ok.post.brand, 'Apple');
  assert.equal(ok.post.model, 'iPhone 16');
  assert.equal(ok.post.seller, 'Ana M.');
  const none = validatePost(base, 0, NOW);
  assert.equal(none.post.brand, '');
  assert.equal(none.post.seller, '');
  const withPhone = validatePost({ ...base, seller_contact: '+53 5 555 1234' }, 0, NOW);
  assert.equal(withPhone.post.seller_contact, '+53 5 555 1234');
});

test('filtro por marca y modelo: campo propio o frase completa, nunca subcadena', () => {
  const posts = [
    { ...base, product: 'Samsung A15', brand: 'Samsung', model: 'A15', group_id: 'g1' },
    { ...base, product: 'Pineapple phone', description: '', group_id: 'g1' },
    { ...base, product: 'iPhone 16 Pro Max', brand: '', model: '', group_id: 'g1' },
  ];
  assert.equal(filterPosts(posts, { brand: 'samsung' }).length, 1);
  assert.equal(filterPosts(posts, { model: 'a15' }).length, 1);
  assert.equal(filterPosts(posts, { brand: 'iphone' }).length, 1); // aparece en el producto
  assert.equal(filterPosts(posts, { brand: 'apple' }).length, 0); // no hay campo ni frase
  assert.equal(filterPosts(posts, { brand: 'pine' }).length, 0); // subcadena: no coincide
});

test('orden: por precio agrupa por moneda y por fecha ordena en ambos sentidos', () => {
  const posts = [
    { ...base, price: 900, currency: 'USD', published_at: '2026-11-10' },
    { ...base, price: 50000, currency: 'CUP', published_at: '2026-11-12' },
    { ...base, price: 700, currency: 'USD', published_at: '2026-11-16' },
  ];
  assert.deepEqual(sortPosts(posts, 'precio_asc').map((p) => `${p.currency}${p.price}`), ['CUP50000', 'USD700', 'USD900']);
  assert.deepEqual(sortPosts(posts, 'precio_desc').map((p) => p.price), [50000, 900, 700]);
  assert.deepEqual(sortPosts(posts, 'fecha_asc').map((p) => p.published_at), ['2026-11-10', '2026-11-12', '2026-11-16']);
  assert.equal(sortPosts(posts).at(0).published_at, '2026-11-16');
});

test('precios atípicos: exigen al menos 5 publicaciones y dispersión', () => {
  const period = resolvePeriod({ end: '2026-11-18', days: 30 }, NOW);
  const prices = [900, 920, 910, 905, 915, 60];
  const posts = prices.map((price, i) => ({ ...base, price, published_at: `2026-11-1${i}`, group_name: 'G', group_id: 'g1' }));
  const res = analyze(posts, period);
  assert.equal(res.outliers.length, 1);
  assert.equal(res.outliers[0].price, 60);
  assert.equal(res.outliers[0].direction, 'bajo');
  assert.equal(analyze(posts.slice(0, 3), period).outliers.length, 0);
});

test('señal de diferencia entre provincias solo con datos suficientes en ambas', () => {
  const period = resolvePeriod({ end: '2026-11-18', days: 30 }, NOW);
  const mk = (province, price, day) => ({ ...base, province, price, published_at: day, group_name: 'G', group_id: 'g1' });
  const posts = [
    mk('La Habana', 1000, '2026-11-10'), mk('La Habana', 1000, '2026-11-11'), mk('La Habana', 1000, '2026-11-12'),
    mk('Matanzas', 800, '2026-11-13'), mk('Matanzas', 800, '2026-11-14'), mk('Matanzas', 800, '2026-11-15'),
  ];
  const res = analyze(posts, period);
  const signal = res.signals.find((s) => s.type === 'diferencia_provincias');
  assert.ok(signal);
  assert.match(signal.text, /La Habana es 25% mayor que en Matanzas/);
  assert.ok(signal.evidence && signal.confidence);
  // Con dos publicaciones en una provincia no hay comparación
  const few = analyze(posts.slice(0, 5), period);
  assert.equal(few.signals.some((s) => s.type === 'diferencia_provincias'), false);
});

test('panel de inicio: sin datos no inventa cifras; con datos calcula cobertura y presencia', () => {
  const empty = buildDashboard([], NOW);
  assert.equal(empty.market.posts_total, 0);
  assert.equal(empty.market.coverage_from, null);
  assert.equal(empty.evolution, null);
  assert.deepEqual(empty.signals, []);
  assert.deepEqual(empty.featured, []);
  assert.deepEqual(empty.provinces, []);

  const posts = [
    { ...base, product: 'iPhone 16', price: 950, published_at: '2026-11-16', group_id: 'g1', group_name: 'A' },
    { ...base, product: 'iPhone 16', price: 980, published_at: '2026-11-17', group_id: 'g2', group_name: 'B' },
    { ...base, product: 'Ventilador', price: 40, published_at: '2026-10-01', group_id: 'g1', group_name: 'A' },
  ];
  const d = buildDashboard(posts, NOW);
  assert.equal(d.market.posts_total, 3);
  assert.equal(d.market.posts_period, 2); // el de octubre queda fuera de 30 días
  assert.equal(d.market.coverage_from, '2026-10-01');
  assert.equal(d.featured.length, 1);
  assert.equal(d.featured[0].name, 'iPhone 16');
  assert.equal(d.featured[0].posts, 2);
  assert.equal(d.featured[0].groups, 2);
});
