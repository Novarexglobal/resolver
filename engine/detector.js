// DETECTOR: señales con evidencia y confianza. Una señal es una observación, no un hecho confirmado.
// Tipos: cambio_precio, brecha_geografica, presencia_nueva.
import { fingerprint } from './core/hash.js';
import { daysBetween, addDays, dayIn, TIMEZONE } from './core/dates.js';
import { median } from './analyzer.js';

export const DEFAULTS = {
  minObservations: 3,
  changeThreshold: 0.15,
  gapThreshold: 0.25,
  lookbackDays: 7,
  presenceDays: 2,
  presenceMinRecords: 2,
};

/** Confianza según cuántas publicaciones sostienen la observación. */
export function confidenceOf(n) {
  if (n >= 10) return 'alta';
  if (n >= 5) return 'media';
  return 'baja';
}

const pct = (n) => Math.round(n * 10000) / 100;

function signal(type, key, day, fields, now) {
  return {
    id: fingerprint([type, key.product_key, key.province || '', key.currency || '', day]),
    type,
    ...key,
    day,
    status: 'activa',
    detected_at: now.toISOString(),
    ...fields,
  };
}

/** Cambio de precio: la mediana del día más reciente frente a la de los días anteriores de la última semana. */
function priceChanges(stats, now, opts) {
  const series = new Map();
  for (const s of stats) {
    if (!s.sufficient) continue;
    const key = `${s.product_key}|${s.province}|${s.currency}`;
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(s);
  }
  const out = [];
  for (const list of series.values()) {
    list.sort((a, b) => (a.day < b.day ? -1 : 1));
    const latest = list[list.length - 1];
    const previous = list.filter((s) => s.day < latest.day && daysBetween(s.day, latest.day) <= opts.lookbackDays);
    if (!previous.length) continue;
    const previousObservations = previous.reduce((a, s) => a + s.count, 0);
    if (previousObservations < opts.minObservations) continue;
    const previousMedian = median(previous.map((s) => s.median).sort((a, b) => a - b));
    const change = (latest.median - previousMedian) / previousMedian;
    if (Math.abs(change) < opts.changeThreshold) continue;
    const key = { product_key: latest.product_key, product: latest.product, province: latest.province, currency: latest.currency };
    out.push(signal('cambio_precio', key, latest.day, {
      title: `${change > 0 ? 'Sube' : 'Baja'} el precio de ${latest.product} en ${latest.province}`,
      evidence: {
        mediana_actual: latest.median,
        mediana_anterior: previousMedian,
        observaciones_actual: latest.count,
        observaciones_anteriores: previousObservations,
        dias_anteriores: previous.length,
        cambio_pct: pct(change),
      },
      confidence: confidenceOf(Math.min(latest.count, previousObservations)),
      note: 'Cambio observado en publicaciones; no mide la demanda.',
    }, now));
  }
  return out;
}

/** Brecha geográfica: diferencia de mediana entre la provincia más cara y la más barata, el mismo día y moneda. */
function geographicGaps(stats, now, opts) {
  const groups = new Map();
  for (const s of stats) {
    if (!s.sufficient) continue;
    const key = `${s.product_key}|${s.currency}|${s.day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.median - b.median);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    const gap = (high.median - low.median) / low.median;
    if (gap < opts.gapThreshold) continue;
    const key = { product_key: low.product_key, product: low.product, province: null, currency: low.currency };
    out.push(signal('brecha_geografica', key, low.day, {
      title: `Diferencia de precio de ${low.product} entre provincias`,
      evidence: {
        provincia_alta: high.province,
        mediana_alta: high.median,
        observaciones_alta: high.count,
        provincia_baja: low.province,
        mediana_baja: low.median,
        observaciones_baja: low.count,
        brecha_pct: pct(gap),
      },
      confidence: confidenceOf(Math.min(low.count, high.count)),
      note: 'Es una diferencia observada. No confirma que se pueda comprar y revender con ganancia.',
    }, now));
  }
  return out;
}

/** Presencia nueva: producto que apareció en los últimos días con varias publicaciones. */
function newPresence(records, now, opts, today) {
  const byProduct = new Map();
  for (const r of records) {
    if (!r.product_key || !r.published_at) continue;
    if (!byProduct.has(r.product_key)) byProduct.set(r.product_key, []);
    byProduct.get(r.product_key).push(r);
  }
  const from = addDays(today, -(opts.presenceDays - 1));
  const out = [];
  for (const [productKey, list] of byProduct) {
    const first = list.reduce((a, r) => (r.published_at < a.published_at ? r : a));
    if (first.published_at < from || list.length < opts.presenceMinRecords) continue;
    const key = { product_key: productKey, product: first.product, province: null, currency: null };
    out.push(signal('presencia_nueva', key, first.published_at, {
      title: `Aparece ${first.product} en el mercado observado`,
      evidence: { publicaciones: list.length, primera_fecha: first.published_at, provincias: [...new Set(list.map((r) => r.province))].length },
      confidence: confidenceOf(list.length),
      note: 'Presencia en publicaciones recientes; no indica demanda.',
    }, now));
  }
  return out;
}

/** Señales a partir de estadísticas y registros. No escribe nada: quien llama decide qué guardar. */
export function detect({ stats, records, now = new Date(), options = {}, timeZone = TIMEZONE }) {
  const opts = { ...DEFAULTS, ...options };
  const today = dayIn(now, timeZone);
  return [
    ...priceChanges(stats, now, opts),
    ...geographicGaps(stats, now, opts),
    ...newPresence(records, now, opts, today),
  ];
}
