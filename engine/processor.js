// PROCESSOR: limpieza, normalización y estructura de una fila de cualquier fuente.
// Entrada: la fila tal como la entregó el adaptador (claves en español o inglés, con o sin acentos).
import { cleanText, productKeyOf, foldText } from './core/text.js';
import { parsePrice, normalizeCurrency } from './core/prices.js';
import { normalizeDay, TIMEZONE } from './core/dates.js';
import { fingerprint, stableHash } from './core/hash.js';
import { classifyGeo } from './rules/geography.js';
import { classify } from './classifier.js';
import { checkRecord, qualityScore } from './quality.js';

// Nombres aceptados para cada campo canónico (ya plegados: sin acentos, espacios → guion bajo)
const ALIASES = {
  product: ['product', 'producto', 'titulo', 'title'],
  price: ['price', 'precio'],
  currency: ['currency', 'moneda'],
  province: ['province', 'provincia'],
  municipality: ['municipality', 'municipio'],
  published_at: ['published_at', 'fecha', 'date', 'fecha_publicada'],
  description: ['description', 'descripcion', 'texto'],
  source_url: ['source_url', 'enlace', 'url', 'link'],
  image_url: ['image_url', 'imagen', 'foto'],
  brand: ['brand', 'marca'],
  model: ['model', 'modelo'],
  category: ['category', 'categoria'],
  seller: ['seller', 'vendedor'],
  seller_contact: ['seller_contact', 'contacto', 'telefono'],
  source_id: ['source_id', 'id', 'id_origen'],
};

/** Pasa las claves de una fila a su nombre canónico. Las claves desconocidas se ignoran. */
export function canonicalRow(raw) {
  const folded = {};
  for (const [key, value] of Object.entries(raw || {})) {
    folded[foldText(key).replace(/ /g, '_')] = value;
  }
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => folded[n] !== undefined && folded[n] !== null && String(folded[n]).trim() !== '');
    out[field] = hit ? folded[hit] : '';
  }
  return out;
}

const isHttpUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Procesa una fila. Devuelve { ok, record, issues, quality }.
 * Si hay un error, record es null y la fila debe ir a cuarentena con sus motivos.
 * record conserva el identificador de la fuente y la huella para la deduplicación.
 */
export function processRow(raw, { now = new Date(), source, defaultCurrency = 'CUP' }) {
  const row = canonicalRow(raw);
  const issues = [];
  const error = (field, message) => issues.push({ severity: 'error', field, message });
  const warning = (field, message) => issues.push({ severity: 'warning', field, message });

  const product = cleanText(row.product, 120);
  if (product.length < 2) error('product', 'Falta el producto (mínimo 2 caracteres).');

  const price = parsePrice(row.price);
  if (!price.ok) error('price', price.error);
  else if (price.note) warning('price', price.note);

  const currency = normalizeCurrency(row.currency, defaultCurrency);
  if (!currency.ok) error('currency', currency.note);
  else if (currency.source === 'por defecto') warning('currency', `Moneda no indicada: se usa ${currency.currency}.`);

  const date = normalizeDay(row.published_at, now, TIMEZONE);
  if (!date.ok) error('published_at', date.error);

  const description = cleanText(row.description, 1000);
  if (String(row.description ?? '').length > 1000) warning('description', 'Descripción recortada a 1000 caracteres.');

  const geo = classifyGeo({ province: row.province, municipality: row.municipality, text: `${product} ${description}` });
  if (!geo.province) error('province', geo.note || 'Provincia sin clasificar.');
  else if (geo.province_source === 'inferida por texto' || geo.province_source === 'inferida por municipio') {
    warning('province', `Provincia ${geo.province_source}: revisar.`);
  }

  const sourceUrl = cleanText(row.source_url, 500);
  if (sourceUrl && !isHttpUrl(sourceUrl)) warning('source_url', 'El enlace no es http(s): se descarta.');
  const imageUrl = cleanText(row.image_url, 500);
  if (imageUrl && !isHttpUrl(imageUrl)) warning('image_url', 'La imagen no es un enlace http(s): se descarta.');

  const sourceId = cleanText(row.source_id, 200) || `hash:${stableHash(raw).slice(0, 32)}`;
  const base = {
    product,
    product_key: productKeyOf(product),
    price: price.value,
    currency: currency.currency,
    currency_source: currency.source,
    country: source.country || 'Cuba',
    province: geo.province,
    municipality: geo.municipality,
    province_source: geo.province_source,
    published_at: date.day,
    description,
    source_url: isHttpUrl(sourceUrl) ? sourceUrl : '',
    image_url: isHttpUrl(imageUrl) ? imageUrl : '',
    seller: cleanText(row.seller, 120),
    seller_contact: cleanText(row.seller_contact, 120),
    brand: cleanText(row.brand, 60),
    model: cleanText(row.model, 60),
    category: cleanText(row.category, 80),
    source_key: source.key,
    source_id: sourceId,
    source_file: cleanText(raw?.source_file, 200),
  };
  Object.assign(base, classify(base));

  base.fingerprint = fingerprint([
    base.product_key,
    base.price,
    base.currency,
    base.province,
    base.municipality,
    base.published_at,
    foldText(base.description).slice(0, 120),
  ]);

  if (issues.some((i) => i.severity === 'error')) {
    return { ok: false, record: null, issues, quality: 0 };
  }
  issues.push(...checkRecord(base, now, TIMEZONE));
  return { ok: true, record: base, issues, quality: qualityScore(issues) };
}
