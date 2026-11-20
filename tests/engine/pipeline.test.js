import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processRow, canonicalRow } from '../../engine/processor.js';
import { classify } from '../../engine/classifier.js';
import { classifyGeo } from '../../engine/rules/geography.js';
import { buildIndex, planBatch } from '../../engine/dedupe.js';
import { PROVINCES } from '../../engine/rules/geography.js';
import { PROVINCES as CONFIG_PROVINCES } from '../../src/config.js';
import { analyze } from '../../engine/analyzer.js';
import { detect } from '../../engine/detector.js';
import { checkRecord, qualityScore } from '../../engine/quality.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const SOURCE = { key: 'manual-test', country: 'Cuba' };
const base = {
  producto: 'Lavadora Mabe 7kg',
  precio: '45.000',
  moneda: 'CUP',
  provincia: 'La Habana',
  fecha: '2026-11-18',
  descripcion: 'Vendo lavadora casi nueva',
  enlace: 'https://ejemplo.org/p/1',
  id: 'a-1',
};
const run = (overrides = {}) => processRow({ ...base, ...overrides }, { now: NOW, source: SOURCE });

test('procesador: fila válida queda normalizada y con origen', () => {
  const r = run();
  assert.equal(r.ok, true);
  assert.equal(r.record.price, 45000);
  assert.equal(r.record.province, 'La Habana');
  assert.equal(r.record.source_key, 'manual-test');
  assert.equal(r.record.source_id, 'a-1');
  assert.equal(r.record.published_at, '2026-11-18');
  assert.ok(r.record.fingerprint.length === 64);
});

test('procesador: nombres de columnas en inglés, con o sin acentos', () => {
  const r = processRow({ product: 'Mesa', price: 200, province: 'Matanzas', published_at: '2026-11-10' }, { now: NOW, source: SOURCE });
  assert.equal(r.ok, true);
  assert.equal(r.record.currency, 'CUP');
  assert.equal(r.record.currency_source, 'por defecto');
  assert.equal(canonicalRow({ 'Teléfono': '5555' }).seller_contact, '5555');
});

test('procesador: errores van a cuarentena con motivo', () => {
  const r = run({ precio: '$', provincia: 'Atlantis', fecha: '2026-12-31' });
  assert.equal(r.ok, false);
  assert.equal(r.record, null);
  const fields = r.issues.filter((i) => i.severity === 'error').map((i) => i.field).sort();
  assert.deepEqual(fields, ['price', 'province', 'published_at']);
});

test('procesador: enlaces no http se descartan con advertencia', () => {
  const r = run({ enlace: 'javascript:alert(1)' });
  assert.equal(r.ok, true);
  assert.equal(r.record.source_url, '');
  assert.ok(r.issues.some((i) => i.field === 'source_url' && i.severity === 'warning'));
});

test('clasificador: la categoría declarada gana; la sugerida se marca', () => {
  const declared = classify({ product: 'Cosa', description: '', category: 'Celulares', brand: '' });
  assert.equal(declared.category, 'Celulares');
  assert.equal(declared.category_source, 'declarada');
  const suggested = classify({ product: 'Lavadora automática', description: '', category: '', brand: '' });
  assert.equal(suggested.category, 'Electrodomésticos');
  assert.equal(suggested.category_source, 'sugerida');
  const unknown = classify({ product: 'Cosa rara', description: '', category: 'Inventada', brand: '' });
  assert.equal(unknown.category, 'Otros');
  assert.equal(unknown.category_declared, 'Inventada');
});

test('clasificador: "poco" y "switch" no disparan marca (falsos positivos evitados)', () => {
  const r = classify({ product: 'Poco uso, switch de luz', description: '', category: '', brand: '' });
  assert.equal(r.brand_source, 'sin dato');
});

test('geografía: provincias del motor iguales a las de RESOLVER', () => {
  assert.deepEqual(PROVINCES, CONFIG_PROVINCES);
});

test('geografía: alias, municipio y texto', () => {
  assert.equal(classifyGeo({ province: 'pinar del rio' }).province, 'Pinar del Río');
  assert.equal(classifyGeo({ province: 'pinar del rio' }).province_source, 'declarada');
  assert.equal(classifyGeo({ province: 'Atlantis' }).province, null);
  assert.equal(classifyGeo({ text: 'Vendo en Matanzas' }).province, 'Matanzas');
  assert.equal(classifyGeo({ text: 'Matanzas y Cienfuegos' }).province, null);
});

test('calidad: advertencias bajan la puntuación; sin advertencias es 1', () => {
  assert.equal(qualityScore([]), 1);
  assert.equal(qualityScore([{ severity: 'warning' }, { severity: 'warning' }]), 0.8);
  const warnings = checkRecord({ currency: 'CUP', price: 5, published_at: '2026-11-18', source_url: '', seller_contact: 'sin numero' }, NOW);
  assert.ok(warnings.length >= 2);
});

test('deduplicación: repetidos dentro del mismo lote y entre fuentes', () => {
  const a = run().record;
  const b = processRow({ ...base, id: 'a-2', descripcion: 'otra descripcion distinta', enlace: 'https://ejemplo.org/p/2' }, { now: NOW, source: SOURCE }).record;
  const c = processRow({ ...base, id: 'a-1' }, { now: NOW, source: { key: 'otra-fuente' } }).record;
  const index = buildIndex([]);
  const plan = planBatch([{ record: a, rawId: 'r1' }, { record: a, rawId: 'r1b' }, { record: b, rawId: 'r2' }], index);
  assert.equal(plan.fresh.length, 2, 'la misma publicación repetida no se inserta dos veces');
  assert.equal(plan.sameSource.length, 1);
  assert.equal(plan.crossSource.length, 0);
  const plan2 = planBatch([{ record: c, rawId: 'r3' }], index);
  assert.equal(plan2.fresh.length, 0);
  assert.equal(plan2.crossSource.length, 1, 'misma huella desde otra fuente se une al existente');
});

test('analizador y detector: sin suficientes observaciones no hay señales', () => {
  const recs = [run().record];
  const stats = analyze(recs, { minObservations: 3 });
  assert.equal(stats.length, 1);
  assert.equal(stats[0].sufficient, false);
  assert.equal(stats[0].median, null, 'con pocas observaciones no se publica mediana');
  assert.deepEqual(detect({ stats, records: recs, now: NOW }), []);
});
