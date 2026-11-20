import { CURRENCIES, COUNTRIES, DEFAULT_COUNTRY, provincesOf } from './config.js';
import { isDay, todayISO } from './analysis.js';

export const MAX_IMPORT_ROWS = 2000;

/** Parser CSV sencillo con soporte de comillas. Detecta coma o punto y coma. */
export function parseCSV(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function parsePrice(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').replace(/[\s$]/g, '');
  // Coma decimal al final ("1.200,50" o "950,5"): los puntos son miles
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  // En otro caso la coma es separador de miles ("1,200.50" o "1,200")
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Valida una fila. Devuelve la publicación normalizada o un error con el número de fila.
 * Nunca inventa campos: lo que no viene, queda vacío o se rechaza.
 */
export function validatePost(raw, index, now = new Date()) {
  if (raw.__error) return { error: { row: index + 1, message: raw.__error } };
  const errors = [];
  const get = (k) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());

  const product = get('product');
  if (product.length < 2 || product.length > 120) errors.push('producto (2 a 120 caracteres)');

  const price = parsePrice(raw.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1e12) errors.push('precio (número mayor que 0)');

  const currency = (get('currency') || 'CUP').toUpperCase();
  if (!CURRENCIES.includes(currency)) errors.push(`moneda (${CURRENCIES.join(', ')})`);

  const province = get('province');
  const country = get('country') || DEFAULT_COUNTRY;
  if (!COUNTRIES.some((c) => c.name === country)) errors.push(`país (${COUNTRIES.map((c) => c.name).join(', ')})`);
  else if (!provincesOf(country).includes(province)) errors.push('provincia (debe coincidir con el catálogo del país)');

  const published_at = get('published_at') || get('date');
  if (!isDay(published_at)) errors.push('fecha publicada (AAAA-MM-DD)');
  else if (published_at > todayISO(now)) errors.push('la fecha publicada no puede ser futura');

  const source_url = get('source_url');
  if (source_url && !isHttpUrl(source_url)) errors.push('enlace de la fuente (http o https)');

  if (errors.length) return { error: { row: index + 1, message: `Revisar: ${errors.join('; ')}` } };

  return {
    post: {
      product,
      price,
      currency,
      country,
      province,
      municipality: get('municipality').slice(0, 80),
      // Vacía si no viene: el clasificador del motor la completa y marca su origen
      category: get('category').slice(0, 60),
      published_at,
      description: get('description').slice(0, 1000),
      source_url,
      image_url: isHttpUrl(get('image_url')) ? get('image_url') : '',
      // Opcionales: solo se guardan si la fuente los publica; no se deducen ni se inventan
      brand: get('brand').slice(0, 60),
      model: get('model').slice(0, 60),
      seller: get('seller').slice(0, 120),
      seller_contact: get('seller_contact').slice(0, 120),
    },
  };
}

/** Valida un lote completo. Devuelve publicaciones válidas y errores por fila. */
export function validateBatch(rows, now = new Date()) {
  if (!Array.isArray(rows)) throw new Error('El contenido debe ser una lista de publicaciones.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);
  const posts = [];
  const errors = [];
  rows.forEach((row, i) => {
    const result = validatePost(row ?? {}, i, now);
    if (result.error) errors.push(result.error);
    else posts.push(result.post);
  });
  return { posts, errors };
}

const LINE_FIELDS = ['product', 'price', 'currency', 'province', 'municipality', 'published_at', 'description', 'source_url'];

/**
 * Carga rápida para escribir desde el teléfono: una publicación por línea.
 * Campos separados por |, siempre 8, aunque alguno vaya vacío:
 *   producto | precio | moneda | provincia | municipio | fecha | descripción | enlace
 * Las líneas vacías y las que empiezan por # se ignoran.
 */
export function parseLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line && !line.startsWith('#'))
    .map(({ line, n }) => {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length !== LINE_FIELDS.length) {
        return { __error: `Línea ${n}: se esperaban ${LINE_FIELDS.length} campos separados por | y hay ${parts.length}.` };
      }
      return Object.fromEntries(LINE_FIELDS.map((k, idx) => [k, parts[idx]]));
    });
}

/** Acepta JSON (lista de objetos) o CSV con cabeceras. */
export function parseImport(contentType, body) {
  const text = String(body ?? '').trim();
  if (!text) throw new Error('El archivo está vacío.');
  if (text.startsWith('[') || text.startsWith('{') || (contentType || '').includes('json')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return parseCSV(text);
}
