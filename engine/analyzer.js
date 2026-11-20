// ANALYZER: estadística de precios por producto, provincia, moneda y día.
// Solo calcula mínimo, máximo, mediana y promedio con al menos minObservations publicaciones. Por debajo, guarda el conteo y nada más.
import { fingerprint } from './core/hash.js';

export function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Una fila por (producto, provincia, moneda, día). id es determinista, así que re-analizar actualiza sin duplicar. */
export function analyze(records, { minObservations = 3 } = {}) {
  const groups = new Map();
  for (const r of records) {
    if (!r.product_key || !r.province || !r.currency || !r.published_at || typeof r.price !== 'number') continue;
    const key = [r.product_key, r.province, r.currency, r.published_at].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        product_key: r.product_key,
        product: r.product,
        province: r.province,
        currency: r.currency,
        day: r.published_at,
        prices: [],
        sources: new Set(),
      });
    }
    const g = groups.get(key);
    g.prices.push(r.price);
    g.sources.add(r.source_key);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g.prices].sort((a, b) => a - b);
    const n = sorted.length;
    const sufficient = n >= minObservations;
    return {
      id: fingerprint(['stat', g.product_key, g.province, g.currency, g.day]),
      product_key: g.product_key,
      product: g.product,
      province: g.province,
      currency: g.currency,
      day: g.day,
      count: n,
      sources: g.sources.size,
      sufficient,
      min: sufficient ? sorted[0] : null,
      max: sufficient ? sorted[n - 1] : null,
      median: sufficient ? median(sorted) : null,
      avg: sufficient ? round2(sorted.reduce((a, b) => a + b, 0) / n) : null,
    };
  });
}
