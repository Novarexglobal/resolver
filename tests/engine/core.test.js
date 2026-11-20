import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, foldText, productKeyOf } from '../../engine/core/text.js';
import { parsePrice, normalizeCurrency } from '../../engine/core/prices.js';
import { normalizeDay, addDays, daysBetween } from '../../engine/core/dates.js';
import { parseCsv } from '../../engine/core/csv.js';
import { fingerprint, stableHash } from '../../engine/core/hash.js';

const NOW = new Date('2026-11-20T12:00:00Z');

test('texto: limpia controles, colapsa espacios y pliega acentos', () => {
  assert.equal(cleanText('  Hola\u0007   mundo \n'), 'Hola mundo');
  assert.equal(cleanText(null), '');
  assert.equal(foldText('Lavadora Mabé, 7kg!'), 'lavadora mabe 7kg');
  assert.equal(productKeyOf('Vendo Lavadora de 7kg'), productKeyOf('lavadora 7kg'));
});

test('precios: formatos cubanos y separadores', () => {
  assert.equal(parsePrice('45000').value, 45000);
  assert.equal(parsePrice('1.200,50').value, 1200.5);
  assert.equal(parsePrice('1,200.50').value, 1200.5);
  assert.equal(parsePrice('1.200').value, 1200);
  assert.equal(parsePrice('$ 300').value, 300);
  assert.equal(parsePrice('300 000').value, 300000);
});

test('precios: lo que no se entiende no se adivina', () => {
  assert.equal(parsePrice('').ok, false);
  assert.equal(parsePrice('a convenir').ok, false);
  assert.equal(parsePrice('100-200').ok, false);
  assert.equal(parsePrice(-5).ok, false);
  assert.equal(parsePrice('1e15').ok, false);
});

test('moneda: vacía usa la del defecto; el símbolo $ solo es ambiguo', () => {
  assert.deepEqual(normalizeCurrency('', 'CUP').currency, 'CUP');
  assert.equal(normalizeCurrency('', 'CUP').source, 'por defecto');
  assert.equal(normalizeCurrency('$', 'CUP').ok, false);
  assert.equal(normalizeCurrency('dólares').currency, 'USD');
  assert.equal(normalizeCurrency('bitcoin').ok, false);
});

test('fechas: formatos aceptados, fechas inexistentes y futuras', () => {
  assert.equal(normalizeDay('2026-11-18', NOW).day, '2026-11-18');
  assert.equal(normalizeDay('18/11/2026', NOW).day, '2026-11-18');
  assert.equal(normalizeDay('2026-02-30', NOW).ok, false);
  assert.equal(normalizeDay('2026-12-01', NOW).ok, false);
  assert.equal(normalizeDay('ayer', NOW).ok, false);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
});

test('CSV: BOM, punto y coma, comillas y líneas vacías', () => {
  const rows = parseCsv('﻿Producto;Precio\r\n"Mesa, grande";1000\r\n\r\nSilla;"2""5"\r\n');
  assert.deepEqual(rows, [
    { producto: 'Mesa, grande', precio: '1000' },
    { producto: 'Silla', precio: '2"5' },
  ]);
  assert.deepEqual(parseCsv(''), []);
});

test('huellas: estables y sensibles al orden', () => {
  assert.equal(fingerprint(['a', null, 1]), fingerprint(['a', '', '1']));
  assert.notEqual(fingerprint(['a', 'b']), fingerprint(['b', 'a']));
  assert.equal(stableHash({ b: 1, a: 2 }), stableHash({ a: 2, b: 1 }));
});
