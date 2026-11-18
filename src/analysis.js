import { createHash } from 'node:crypto';
import { MAX_PERIOD_DAYS, MIN_OBSERVATIONS, MIN_DISTINCT_DAYS } from './config.js';

const DAY_MS = 864e5;

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

/** Filtra publicaciones por texto, provincia, municipio, categoría y período. */
export function filterPosts(posts, filters) {
  const tokens = normalizeText(filters.q).split(' ').filter(Boolean);
  const municipality = normalizeText(filters.municipality);
  return posts.filter((p) => {
    if (filters.province && p.province !== filters.province) return false;
    if (municipality && normalizeText(p.municipality) !== municipality) return false;
    if (filters.category && p.category !== filters.category) return false;
    if (filters.start && p.published_at < filters.start) return false;
    if (filters.end && p.published_at > filters.end) return false;
    if (tokens.length) {
      const haystack = normalizeText(`${p.product} ${p.description ?? ''}`);
      if (!tokens.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });
}

export function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

const round = (x) => Math.round(x * 100) / 100;

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

/**
 * Analiza la oferta observable. No mide demanda real: solo describe lo publicado.
 */
export function analyze(posts, period) {
  const warnings = [];
  const currencies = [...new Set(posts.map((p) => p.currency))];

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
    const first = series.slice(0, mid).reduce((s, d) => s + d.avg * d.count, 0) / series.slice(0, mid).reduce((s, d) => s + d.count, 0);
    const second = series.slice(mid).reduce((s, d) => s + d.avg * d.count, 0) / series.slice(mid).reduce((s, d) => s + d.count, 0);
    const pct = round(((second - first) / first) * 100);
    signals.push({
      type: 'tendencia_precio',
      currency: cur,
      text: `El precio medio observado ${pct >= 0 ? 'subió' : 'bajó'} ${Math.abs(pct)}% entre la primera y la segunda mitad del período (${cur}).`,
    });
  }

  const byGroup = group(posts, (p) => p.group_name);
  if (posts.length >= MIN_OBSERVATIONS && byGroup.length && byGroup[0].count / posts.length >= 0.6) {
    signals.push({
      type: 'concentracion_fuente',
      text: `${Math.round((byGroup[0].count / posts.length) * 100)}% de la oferta observada proviene de un solo grupo ("${byGroup[0].key}").`,
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
    signals,
    warnings,
  };
}
