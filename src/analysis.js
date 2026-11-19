import { createHash } from 'node:crypto';
import { MAX_PERIOD_DAYS, MIN_OBSERVATIONS, MIN_DISTINCT_DAYS, CURRENCIES } from './config.js';

const DAY_MS = 864e5;
const MIN_PROVINCE_GAP_PCT = 20; // diferencia mínima entre provincias para emitir señal
const MIN_OUTLIER_OBSERVATIONS = 5; // mínimo por producto y moneda para buscar atípicos
export const SORTS = ['fecha_desc', 'fecha_asc', 'precio_asc', 'precio_desc'];

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Fecha de referencia en Cuba (no en UTC): define "hoy" para cargas y pendientes
export const APP_TIMEZONE = 'America/Havana';

export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const round = (x) => Math.round(x * 100) / 100;

/** Resumen mensual de publicaciones: cantidad y precios por moneda (solo lo observado). */
export function monthlySummary(posts) {
  const months = new Map();
  for (const p of posts) {
    const month = p.published_at.slice(0, 7);
    if (!months.has(month)) months.set(month, { count: 0, prices: {} });
    const m = months.get(month);
    m.count += 1;
    (m.prices[p.currency] ??= []).push(p.price);
  }
  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, m]) => ({
      month,
      count: m.count,
      byCurrency: Object.fromEntries(
        Object.entries(m.prices).map(([cur, list]) => [
          cur,
          { count: list.length, min: Math.min(...list), avg: round(list.reduce((a, b) => a + b, 0) / list.length), max: Math.max(...list) },
        ]),
      ),
    }));
}

function addDays(day, n) {
  return new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Resuelve el período de análisis: termina en `end` (no puede ser futuro) y
 * abarca `days` días hacia atrás (1 a 30).
 */
export function resolvePeriod({ end, days }, now = new Date()) {
  const today = todayISO(now);
  const endDay = isDay(end) ? end : today;
  if (endDay > today) throw new Error('La fecha final no puede ser futura.');
  const n = Number.parseInt(days, 10) || 7;
  if (n < 1 || n > MAX_PERIOD_DAYS) throw new Error(`El período debe tener entre 1 y ${MAX_PERIOD_DAYS} días.`);
  return { start: addDays(endDay, -(n - 1)), end: endDay, days: n };
}

export function postKey(post) {
  if (post.source_url) return `url:${normalizeText(post.source_url)}`;
  const base = [
    normalizeText(post.product),
    post.price,
    post.currency,
    post.province,
    normalizeText(post.municipality),
    post.published_at,
    post.group_id,
    normalizeText(post.description).slice(0, 200),
  ].join('|');
  return `fp:${createHash('sha256').update(base).digest('hex')}`;
}

/** Devuelve las publicaciones que no estén ya presentes (por clave de deduplicación). */
export function dedupe(existing, incoming) {
  const seen = new Set(existing.map(postKey));
  const fresh = [];
  const skipped = [];
  for (const post of incoming) {
    const key = postKey(post);
    if (seen.has(key)) skipped.push(post);
    else {
      seen.add(key);
      fresh.push(post);
    }
  }
  return { fresh, skipped };
}

// Coincidencia de una frase completa (no de subcadena): "apple" no coincide con "pineapple"
const phraseIn = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

/**
 * Filtra publicaciones. Marca y modelo coinciden con el campo propio de la publicación
 * o con la frase tal como aparece en el producto o la descripción.
 */
export function filterPosts(posts, filters) {
  const tokens = normalizeText(filters.q).split(' ').filter(Boolean);
  const municipality = normalizeText(filters.municipality);
  const brand = normalizeText(filters.brand);
  const model = normalizeText(filters.model);
  return posts.filter((p) => {
    if (filters.province && p.province !== filters.province) return false;
    if (municipality && normalizeText(p.municipality) !== municipality) return false;
    if (filters.category && p.category !== filters.category) return false;
    if (filters.start && p.published_at < filters.start) return false;
    if (filters.end && p.published_at > filters.end) return false;
    const text = normalizeText(`${p.product} ${p.description ?? ''}`);
    if (tokens.length && !tokens.every((t) => text.includes(t))) return false;
    if (brand && normalizeText(p.brand) !== brand && !phraseIn(text, brand)) return false;
    if (model && normalizeText(p.model) !== model && !phraseIn(text, model)) return false;
    return true;
  });
}

/**
 * Ordena publicaciones. El orden por precio agrupa por moneda primero:
 * un CUP y un USD no se mezclan en la misma lista de precios.
 */
export function sortPosts(posts, sort = 'fecha_desc') {
  const byDate = (a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0);
  const currencyRank = (p) => {
    const i = CURRENCIES.indexOf(p.currency);
    return i === -1 ? CURRENCIES.length : i;
  };
  const comparators = {
    fecha_desc: byDate,
    fecha_asc: (a, b) => -byDate(a, b),
    precio_asc: (a, b) => currencyRank(a) - currencyRank(b) || a.price - b.price || byDate(a, b),
    precio_desc: (a, b) => currencyRank(a) - currencyRank(b) || b.price - a.price || byDate(a, b),
  };
  return [...posts].sort(comparators[sort] ?? byDate);
}

export function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function priceStats(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const count = sorted.length;
  const sufficient = count >= MIN_OBSERVATIONS;
  return {
    count,
    sufficient,
    min: sufficient ? sorted[0] : null,
    max: sufficient ? sorted[count - 1] : null,
    avg: sufficient ? round(sorted.reduce((a, b) => a + b, 0) / count) : null,
    median: sufficient ? median(sorted) : null,
  };
}

function group(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Precios atípicos por producto y moneda (método de rango intercuartílico). Sin dispersión no marca nada. */
function findOutliers(posts) {
  const byProduct = new Map();
  for (const p of posts) {
    const key = `${normalizeText(p.product)}|${p.currency}`;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(p);
  }
  const found = [];
  for (const list of byProduct.values()) {
    if (list.length < MIN_OUTLIER_OBSERVATIONS) continue;
    const sorted = list.map((p) => p.price).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    const med = median(sorted);
    for (const p of list) {
      if (p.price < low || p.price > high) {
        found.push({
          product: p.product,
          currency: p.currency,
          price: p.price,
          median: med,
          direction: p.price < low ? 'bajo' : 'alto',
          province: p.province,
          municipality: p.municipality,
          published_at: p.published_at,
          group_name: p.group_name,
          source_url: p.source_url,
        });
      }
    }
  }
  return found.sort((a, b) => (a.published_at < b.published_at ? 1 : -1)).slice(0, 10);
}

/**
 * Analiza la oferta observable. No mide demanda real: solo describe lo publicado.
 */
export function analyze(posts, period) {
  const warnings = [];
  const currencies = [...new Set(posts.map((p) => p.currency))];
  if (currencies.length > 1) {
    warnings.push('Hay publicaciones en varias monedas. Los precios se comparan solo dentro de cada moneda.');
  }

  const byCurrency = {};
  for (const cur of currencies) {
    const prices = posts.filter((p) => p.currency === cur).map((p) => p.price);
    byCurrency[cur] = priceStats(prices);
    if (!byCurrency[cur].sufficient) {
      warnings.push(`Datos insuficientes para estadísticas de precio en ${cur} (mínimo ${MIN_OBSERVATIONS} publicaciones).`);
    }
  }
  if (!posts.length) warnings.push('No hay publicaciones para este período y filtros.');

  // Evolución diaria por moneda (solo si hay suficientes días distintos)
  const evolution = {};
  for (const cur of currencies) {
    const perDay = new Map();
    for (const p of posts.filter((x) => x.currency === cur)) {
      if (!perDay.has(p.published_at)) perDay.set(p.published_at, []);
      perDay.get(p.published_at).push(p.price);
    }
    if (perDay.size >= MIN_DISTINCT_DAYS) {
      evolution[cur] = [...perDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, prices]) => ({ day, count: prices.length, avg: round(prices.reduce((a, b) => a + b, 0) / prices.length) }));
    } else {
      evolution[cur] = null;
    }
  }

  const signals = [];
  for (const cur of currencies) {
    const series = evolution[cur];
    if (!series || series.length < 2) continue;
    const mid = Math.floor(series.length / 2);
    const firstHalf = series.slice(0, mid);
    const secondHalf = series.slice(mid);
    const first = firstHalf.reduce((s, d) => s + d.avg * d.count, 0) / firstHalf.reduce((s, d) => s + d.count, 0);
    const second = secondHalf.reduce((s, d) => s + d.avg * d.count, 0) / secondHalf.reduce((s, d) => s + d.count, 0);
    const pct = round(((second - first) / first) * 100);
    const count = series.reduce((s, d) => s + d.count, 0);
    signals.push({
      type: 'tendencia_precio',
      currency: cur,
      text: `El precio medio observado ${pct >= 0 ? 'subió' : 'bajó'} ${Math.abs(pct)}% entre la primera y la segunda mitad del período (${cur}).`,
      evidence: `${series.length} día(s) con datos y ${count} publicación(es) en ${cur}.`,
      confidence: series.length >= 4 ? 'media' : 'baja',
    });
  }

  // Diferencias de precio entre provincias (solo provincias con datos suficientes)
  for (const cur of currencies) {
    const perProvince = new Map();
    for (const p of posts.filter((x) => x.currency === cur && x.province)) {
      if (!perProvince.has(p.province)) perProvince.set(p.province, []);
      perProvince.get(p.province).push(p.price);
    }
    const comparable = [...perProvince.entries()]
      .filter(([, list]) => list.length >= MIN_OBSERVATIONS)
      .map(([province, list]) => ({ province, count: list.length, avg: list.reduce((a, b) => a + b, 0) / list.length }))
      .sort((a, b) => a.avg - b.avg);
    if (comparable.length < 2) continue;
    const low = comparable[0];
    const high = comparable[comparable.length - 1];
    const pct = round(((high.avg - low.avg) / low.avg) * 100);
    if (pct >= MIN_PROVINCE_GAP_PCT) {
      signals.push({
        type: 'diferencia_provincias',
        currency: cur,
        text: `El precio medio observado en ${high.province} es ${pct}% mayor que en ${low.province} (${cur}).`,
        evidence: `${high.count} publicación(es) en ${high.province} y ${low.count} en ${low.province}.`,
        confidence: 'baja',
      });
    }
  }

  const byGroup = group(posts, (p) => p.group_name);
  if (posts.length >= MIN_OBSERVATIONS && byGroup.length && byGroup[0].count / posts.length >= 0.6) {
    const pct = Math.round((byGroup[0].count / posts.length) * 100);
    signals.push({
      type: 'concentracion_fuente',
      text: `${pct}% de la oferta observada proviene de un solo grupo ("${byGroup[0].key}").`,
      evidence: `${byGroup[0].count} de ${posts.length} publicaciones.`,
      confidence: 'media',
    });
  }

  return {
    period,
    total: posts.length,
    sources: byGroup.length,
    prices: byCurrency,
    evolution,
    distribution: {
      byProvince: group(posts, (p) => p.province),
      byMunicipality: group(posts, (p) => p.municipality),
      byGroup,
    },
    outliers: findOutliers(posts),
    signals,
    warnings,
  };
}

/** Moneda con más publicaciones en el conjunto (o null si no hay ninguna). */
export function primaryCurrency(posts) {
  const counts = group(posts, (p) => p.currency);
  return counts.length ? counts[0].key : null;
}

/** Productos con mayor presencia en publicaciones (no mide demanda). Solo los que aparecen al menos 2 veces. */
function featuredProducts(posts) {
  const map = new Map();
  for (const p of posts) {
    const key = normalizeText(p.product);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: p.product, count: 0, groups: new Set(), prices: {} });
    const entry = map.get(key);
    entry.count += 1;
    entry.groups.add(p.group_id);
    (entry.prices[p.currency] ??= []).push(p.price);
  }
  return [...map.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
    .slice(0, 8)
    .map((e) => ({
      name: e.name,
      posts: e.count,
      groups: e.groups.size,
      byCurrency: Object.fromEntries(
        Object.entries(e.prices)
          .filter(([, list]) => list.length >= MIN_OBSERVATIONS)
          .map(([cur, list]) => {
            const sorted = [...list].sort((a, b) => a - b);
            return [cur, { count: sorted.length, min: sorted[0], median: median(sorted), max: sorted[sorted.length - 1] }];
          }),
      ),
    }));
}

/** Estadísticas por provincia; el precio solo aparece si hay datos suficientes en la moneda principal. */
function provinceStats(posts, currency) {
  const map = new Map();
  for (const p of posts) {
    if (!p.province) continue;
    if (!map.has(p.province)) map.set(p.province, []);
    map.get(p.province).push(p);
  }
  return [...map.entries()]
    .map(([province, list]) => {
      const prices = currency ? list.filter((p) => p.currency === currency).map((p) => p.price).sort((a, b) => a - b) : [];
      const sufficient = prices.length >= MIN_OBSERVATIONS;
      return {
        province,
        posts: list.length,
        currency: sufficient ? currency : null,
        priced: prices.length,
        avg: sufficient ? round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
        median: sufficient ? median(prices) : null,
      };
    })
    .sort((a, b) => b.posts - a.posts || a.province.localeCompare(b.province, 'es'));
}

/**
 * Datos del panel de inicio a partir de publicaciones de grupos activos.
 * Si no hay datos, todas las listas quedan vacías: nunca se inventan cifras.
 */
export function buildDashboard(posts, now = new Date()) {
  const today = todayISO(now);
  const period = resolvePeriod({ end: today, days: MAX_PERIOD_DAYS }, now);
  const week = resolvePeriod({ end: today, days: 7 }, now);
  const inPeriod = posts.filter((p) => p.published_at >= period.start && p.published_at <= period.end);
  const analysis = analyze(inPeriod, period);
  const currency = primaryCurrency(inPeriod);
  const allDates = posts.map((p) => p.published_at).sort();

  return {
    period,
    market: {
      posts_total: posts.length,
      posts_period: inPeriod.length,
      posts_last_7_days: posts.filter((p) => p.published_at >= week.start && p.published_at <= week.end).length,
      groups_with_data: new Set(posts.map((p) => p.group_id)).size,
      provinces_in_period: new Set(inPeriod.map((p) => p.province)).size,
      coverage_from: allDates[0] ?? null,
      coverage_to: allDates[allDates.length - 1] ?? null,
    },
    primary_currency: currency,
    evolution: currency && analysis.evolution[currency] ? analysis.evolution[currency] : null,
    signals: analysis.signals.map((s) => ({ ...s, period })),
    featured: featuredProducts(inPeriod),
    provinces: provinceStats(inPeriod, currency),
    warnings: analysis.warnings,
  };
}
