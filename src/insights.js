import { analyze, median, normalizeText, resolvePeriod, todayISO } from './analysis.js';
import { CURRENCIES, MAX_PERIOD_DAYS, MIN_OBSERVATIONS } from './config.js';
import { parentOf } from './catalog.js';

const DAY_MS = 864e5;
const round = (x) => Math.round(x * 100) / 100;
const shiftDay = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
const inWindow = (p, a, b) => p.published_at >= a && p.published_at <= b;
const pct = (from, to) => (from ? round(((to - from) / from) * 100) : null);

export const SIGNAL_TITLES = {
  tendencia_precio: 'Cambio del precio medio',
  diferencia_provincias: 'Diferencia de precios entre provincias',
  concentracion_fuente: 'Oferta concentrada en un grupo',
  precio_inusualmente_bajo: 'Precio inusualmente bajo',
  precio_inusualmente_alto: 'Precio inusualmente alto',
  presencia_creciente: 'Presencia comercial creciente',
  movimiento_precio: 'Movimiento significativo de precio',
  oportunidad_potencial: 'Posible oportunidad de compra o reventa',
  aumento_disponibilidad: 'Aumento de publicaciones observadas',
  disminucion_publicaciones: 'Disminución de publicaciones observadas',
};

export const OPPORTUNITY_TYPES = ['oportunidad_potencial', 'precio_inusualmente_bajo'];
export const MOVEMENT_TYPES = ['movimiento_precio', 'presencia_creciente', 'aumento_disponibilidad', 'disminucion_publicaciones'];

export function statsOf(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < MIN_OBSERVATIONS) return { count: n, sufficient: false, median: null, avg: null };
  return { count: n, sufficient: true, median: median(sorted), avg: round(sorted.reduce((a, b) => a + b, 0) / n) };
}

/** Compara dos períodos del mismo conjunto de publicaciones. Solo calcula cambios cuando ambos tienen datos suficientes. */
export function compareWindows(current, previous) {
  const currencies = [...new Set([...current, ...previous].map((p) => p.currency))];
  const byCurrency = {};
  for (const cur of currencies) {
    const a = statsOf(current.filter((p) => p.currency === cur).map((p) => p.price));
    const b = statsOf(previous.filter((p) => p.currency === cur).map((p) => p.price));
    byCurrency[cur] = {
      current: a,
      previous: b,
      median_change_pct: a.sufficient && b.sufficient ? pct(b.median, a.median) : null,
    };
  }
  return {
    current_total: current.length,
    previous_total: previous.length,
    posts_change_pct: pct(previous.length, current.length),
    currencies: byCurrency,
  };
}

/** Precio mediano por municipio en una moneda, solo con datos suficientes. */
export function municipalityPrices(posts, currency) {
  if (!currency) return [];
  const map = new Map();
  for (const p of posts) {
    if (p.currency !== currency || !p.municipality) continue;
    if (!map.has(p.municipality)) map.set(p.municipality, { province: p.province, prices: [] });
    map.get(p.municipality).prices.push(p.price);
  }
  return [...map.entries()]
    .map(([municipality, { province, prices }]) => ({ municipality, province, currency, ...statsOf(prices) }))
    .filter((m) => m.sufficient)
    .sort((a, b) => a.median - b.median);
}

/**
 * Busca señales en las publicaciones de grupos activos.
 * Cada resultado es una observación con su evidencia y nivel de confianza; no es una conclusión confirmada.
 */
export function detectCandidates(posts, now = new Date()) {
  const today = todayISO(now);
  const period = resolvePeriod({ end: today, days: MAX_PERIOD_DAYS }, now);
  const cur = resolvePeriod({ end: today, days: 7 }, now);
  const prev = resolvePeriod({ end: shiftDay(cur.start, -1), days: 7 }, now);
  const inPeriod = posts.filter((p) => inWindow(p, period.start, period.end));
  const curPosts = posts.filter((p) => inWindow(p, cur.start, cur.end));
  const prevPosts = posts.filter((p) => inWindow(p, prev.start, prev.end));
  const out = [];
  const add = (c) => out.push({ period, filters: { days: MAX_PERIOD_DAYS, end: today }, product: null, province: null, currency: null, ...c });

  // Señales del análisis de 30 días: tendencia, diferencia entre provincias y concentración de fuente
  const analysis = analyze(inPeriod, period);
  for (const s of analysis.signals) {
    add({ type: s.type, description: s.text, currency: s.currency ?? null, evidence: s.evidence, confidence: s.confidence });
  }

  // Precios atípicos (método intercuartílico, mínimo 5 publicaciones por producto y moneda)
  for (const o of analysis.outliers) {
    add({
      type: o.direction === 'bajo' ? 'precio_inusualmente_bajo' : 'precio_inusualmente_alto',
      description: `"${o.product}" aparece a ${o.price} ${o.currency}, frente a una mediana de ${o.median} ${o.currency} en publicaciones similares.`,
      product: o.product,
      province: o.province || null,
      currency: o.currency,
      evidence: `Publicación del ${o.published_at} en ${o.group_name}.`,
      confidence: 'baja',
      filters: { q: o.product, province: o.province || '', days: MAX_PERIOD_DAYS, end: today },
    });
  }

  // Señales por producto
  const keyOf = (p) => normalizeText(p.product);
  const names = new Map();
  for (const p of inPeriod) if (keyOf(p) && !names.has(keyOf(p))) names.set(keyOf(p), p.product);
  for (const [key, name] of names) {
    const nCur = curPosts.filter((p) => keyOf(p) === key).length;
    const nPrev = prevPosts.filter((p) => keyOf(p) === key).length;
    if (nCur >= 3 && nCur >= 2 * Math.max(nPrev, 1)) {
      add({
        type: 'presencia_creciente',
        product: name,
        description: `"${name}" aparece en ${nCur} publicaciones en los últimos 7 días, frente a ${nPrev} en los 7 anteriores.`,
        evidence: `${nCur} frente a ${nPrev} publicaciones.`,
        confidence: nCur >= 5 ? 'media' : 'baja',
        filters: { q: name, days: 7, end: cur.end },
      });
    }

    const currencies = [...new Set(inPeriod.filter((p) => keyOf(p) === key).map((p) => p.currency))];
    for (const c of currencies) {
      const a = curPosts.filter((p) => keyOf(p) === key && p.currency === c).map((p) => p.price);
      const b = prevPosts.filter((p) => keyOf(p) === key && p.currency === c).map((p) => p.price);
      if (a.length >= MIN_OBSERVATIONS && b.length >= MIN_OBSERVATIONS) {
        const change = pct(statsOf(b).median, statsOf(a).median);
        if (Math.abs(change) >= 20) {
          add({
            type: 'movimiento_precio',
            product: name,
            currency: c,
            description: `La mediana de "${name}" ${change > 0 ? 'subió' : 'bajó'} ${Math.abs(change)}% en ${c} frente a los 7 días anteriores.`,
            evidence: `${a.length} publicaciones recientes frente a ${b.length} anteriores.`,
            confidence: 'baja',
            filters: { q: name, days: 7, end: cur.end },
          });
        }
      }

      // Diferencia de precio entre provincias para el mismo producto (oportunidad potencial, no confirmada)
      const byProvince = new Map();
      for (const p of inPeriod) {
        if (keyOf(p) !== key || p.currency !== c || !p.province) continue;
        if (!byProvince.has(p.province)) byProvince.set(p.province, []);
        byProvince.get(p.province).push(p.price);
      }
      const comparable = [...byProvince.entries()]
        .filter(([, list]) => list.length >= MIN_OBSERVATIONS)
        .map(([province, list]) => ({ province, n: list.length, avg: list.reduce((x, y) => x + y, 0) / list.length }))
        .sort((x, y) => x.avg - y.avg);
      if (comparable.length >= 2) {
        const low = comparable[0];
        const high = comparable[comparable.length - 1];
        const gap = pct(low.avg, high.avg);
        if (gap >= 20) {
          add({
            type: 'oportunidad_potencial',
            product: name,
            province: low.province,
            currency: c,
            description: `"${name}" tiene un precio medio ${gap}% mayor en ${high.province} que en ${low.province} (${c}). Es una diferencia observada, no confirmada: podría indicar una oportunidad de compra o reventa.`,
            evidence: `${low.n} publicaciones en ${low.province} y ${high.n} en ${high.province}.`,
            confidence: 'baja',
            filters: { q: name, province: low.province, days: MAX_PERIOD_DAYS, end: today },
          });
        }
      }
    }
  }

  // Disponibilidad observable en general
  if (prevPosts.length >= 5 && curPosts.length >= 2 * prevPosts.length) {
    add({
      type: 'aumento_disponibilidad',
      description: `Hay ${curPosts.length} publicaciones observadas en los últimos 7 días, frente a ${prevPosts.length} en los 7 anteriores.`,
      evidence: `${curPosts.length} frente a ${prevPosts.length} publicaciones.`,
      confidence: 'media',
      filters: { days: 7, end: cur.end },
    });
  }
  if (prevPosts.length >= 5 && curPosts.length <= prevPosts.length / 2) {
    add({
      type: 'disminucion_publicaciones',
      description: `Hay ${curPosts.length} publicaciones observadas en los últimos 7 días, frente a ${prevPosts.length} en los 7 anteriores.`,
      evidence: `${curPosts.length} frente a ${prevPosts.length} publicaciones.`,
      confidence: 'media',
      filters: { days: 7, end: cur.end },
    });
  }
  return out;
}

/**
 * Guarda en la base las señales nuevas. Una misma señal (tipo, producto, provincia, moneda y día)
 * se guarda una sola vez. Las señales nunca se borran: el administrador puede retirarlas.
 */
export function syncSignals(store, posts, now = new Date()) {
  const candidates = detectCandidates(posts, now);
  const detectedAt = now.toISOString();
  let created = 0;
  for (const c of candidates) {
    const key = [c.type, c.product ?? '', c.province ?? '', c.currency ?? '', c.period.end].join('|');
    if (store.get('signals', (s) => s.key === key)) continue;
    store.insert('signals', { ...c, key, title: SIGNAL_TITLES[c.type] ?? c.type, detected_at: detectedAt, status: 'activa' });
    created += 1;
  }
  return { candidates: candidates.length, created };
}

/** Exploración: productos con su presencia y precios (solo con datos suficientes). */
export function exploreProducts(posts) {
  const map = new Map();
  for (const p of posts) {
    const key = normalizeText(p.product);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: p.product, posts: [], groups: new Set() });
    const entry = map.get(key);
    entry.posts.push(p);
    entry.groups.add(p.group_id);
  }
  return [...map.values()]
    .map((e) => ({
      name: e.name,
      posts: e.posts.length,
      groups: e.groups.size,
      byCurrency: Object.fromEntries(
        CURRENCIES.filter((c) => e.posts.some((p) => p.currency === c)).map((c) => {
          const s = statsOf(e.posts.filter((p) => p.currency === c).map((p) => p.price));
          return [c, s];
        }),
      ),
    }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name, 'es'))
    .slice(0, 50);
}

/** Exploración: categorías agrupadas por rama del árbol del módulo 7. */
export function exploreCategories(posts) {
  const tops = new Map();
  for (const p of posts) {
    const leaf = p.category || 'Otros';
    const top = parentOf(leaf) || leaf;
    if (!tops.has(top)) tops.set(top, { name: top, posts: 0, children: new Map() });
    const entry = tops.get(top);
    entry.posts += 1;
    if (leaf !== top) entry.children.set(leaf, (entry.children.get(leaf) || 0) + 1);
  }
  return [...tops.values()]
    .map((t) => ({
      name: t.name,
      posts: t.posts,
      children: [...t.children.entries()].map(([name, posts]) => ({ name, posts })).sort((a, b) => b.posts - a.posts),
    }))
    .sort((a, b) => b.posts - a.posts);
}
