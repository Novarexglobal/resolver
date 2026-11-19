const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = { config: null, user: null, groups: [], search: null };
// El contenido de #results lo genera este script; se vacía el marcador inicial.
$('results').replaceChildren();

// ---------- utilidades ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const money = (v, cur) => (v == null ? '—' : `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(v)} ${cur}`);
const dateText = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const shortDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) : '');
// Hoy en Cuba, no en UTC: después de las 7 p. m. en Cuba la fecha UTC ya es del día siguiente
const todayHavana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un error inesperado.');
    err.status = res.status;
    if (res.status === 401 && state.user) showAuth();
    throw err;
  }
  return data;
}

// ---------- acceso ----------
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('active', b.dataset.auth === mode));
  $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('auth-pass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('auth-hint').textContent = mode === 'register' ? 'Usuario: 3 a 30 caracteres (letras, números, . _ -). Contraseña: mínimo 10.' : '';
  $('auth-error').classList.add('hidden');
}

function showAuth() {
  state.user = null;
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
}

document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('auth-user').value.trim().toLowerCase();
  const password = $('auth-pass').value;
  const errorBox = $('auth-error');
  errorBox.classList.add('hidden');
  if (!username || !password) return showAuthError('Completa usuario y contraseña.');
  const btn = $('auth-submit');
  btn.disabled = true;
  try {
    const data = await api(authMode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body: { username, password } });
    state.user = data.user;
    $('auth-pass').value = '';
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showAuthError(message) {
  const box = $('auth-error');
  box.textContent = message;
  box.classList.remove('hidden');
}

$('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* sesión ya cerrada */ }
  showAuth();
});

async function enterApp() {
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent = state.user.username;
  $('admin-link').classList.toggle('hidden', state.user.role !== 'superadmin');
  if (!state.config) await loadConfig();
  setView('inicio');
}

// ---------- configuración y filtros ----------
async function loadConfig() {
  state.config = await api('/api/config');
  const { provinces, categories, maxPeriodDays } = state.config;
  for (const p of provinces) $('province').append(el('option', { value: p, text: p }));
  for (const c of categories) $('category').append(el('option', { value: c, text: c }));
  $('days').querySelector('option[value="30"]').textContent = `Últimos ${maxPeriodDays} días`;
  const today = todayHavana();
  $('end').max = today;
  $('end').value = today;
}

async function loadMunicipalities(province, selected = '') {
  const select = $('municipality');
  select.replaceChildren(el('option', { value: '', text: 'Todos' }));
  select.disabled = !province;
  if (!province) return;
  try {
    const { municipalities } = await api(`/api/municipalities?province=${encodeURIComponent(province)}`);
    for (const m of municipalities) select.append(el('option', { value: m, text: m }));
    if (!municipalities.length) select.append(el('option', { value: '', text: 'Sin datos aún', disabled: true }));
    select.value = selected && municipalities.includes(selected) ? selected : '';
  } catch (err) {
    toast(err.message);
  }
}

$('province').addEventListener('change', (e) => loadMunicipalities(e.target.value));

// ---------- navegación ----------
const VIEWS = ['inicio', 'buscar', 'grupos', 'historial', 'reportes'];

function setView(name) {
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== name);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'inicio') loadDashboard();
  if (name === 'grupos') loadGroups();
  if (name === 'historial') loadHistory();
}

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.go)));

// ---------- búsqueda ----------
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(collectFilters());
});

function collectFilters() {
  return {
    q: $('q').value.trim(),
    brand: $('brand').value.trim(),
    model: $('model').value.trim(),
    sort: $('sort').value,
    province: $('province').value,
    municipality: $('municipality').value,
    category: $('category').value,
    days: $('days').value,
    end: $('end').value,
  };
}

// Una búsqueda nueva reemplaza la anterior; "Cargar más" pide la página siguiente con el mismo filtro
async function runSearch(f) {
  state.search = { filters: f, nextOffset: null };
  await fetchSearch(false);
}

async function fetchSearch(more) {
  if (!state.search) return;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.search.filters)) if (v) params.set(k, v);
  if (more) params.set('offset', String(state.search.nextOffset));
  const btn = $('search-submit');
  const moreBtn = $('more-btn');
  if (more) {
    if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'Cargando…'; }
  } else {
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    $('results').classList.remove('hidden');
    $('search-alerts').replaceChildren();
    $('results').replaceChildren(el('div', { class: 'card' }, el('div', { class: 'skeleton' }), el('div', { class: 'skeleton', style: 'width:60%' })));
  }
  try {
    const data = await api(`/api/search?${params}`);
    if (more) appendResults(data);
    else renderResults(data);
  } catch (err) {
    if (more) {
      toast(err.message);
      if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Cargar más'; }
    } else {
      $('results').classList.add('hidden');
      $('search-alerts').replaceChildren(el('div', { class: 'alert error', role: 'alert', text: err.message }));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
}

function stat(label, value, sub) {
  return el('div', { class: 'card stat', style: 'margin:0' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub', text: sub }) : null);
}

function barList(items, labelKey = 'key', max = 8) {
  if (!items.length) return el('p', { class: 'muted', text: 'Sin datos.' });
  const top = items.slice(0, max);
  const peak = Math.max(...top.map((i) => i.count));
  return el(
    'div',
    { class: 'bars' },
    top.map((i) =>
      el(
        'div',
        { class: 'bar-row' },
        el('span', { text: i[labelKey] }),
        el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${Math.round((i.count / peak) * 100)}%` })),
        el('span', { class: 'num', text: String(i.count) }),
      ),
    ),
  );
}

function evolutionChart(series, cur) {
  const W = 600;
  const H = 180;
  const P = 24;
  const peak = Math.max(...series.map((d) => d.avg));
  const bw = (W - P * 2) / series.length;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Precio medio por día en ${cur}`);
  const axis = document.createElementNS(NS, 'line');
  axis.setAttribute('x1', P); axis.setAttribute('x2', W - P); axis.setAttribute('y1', H - P); axis.setAttribute('y2', H - P);
  axis.setAttribute('class', 'axis');
  svg.append(axis);
  series.forEach((d, i) => {
    const h = peak ? (d.avg / peak) * (H - P - 16) : 0;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', P + i * bw + bw * 0.15);
    rect.setAttribute('y', H - P - h);
    rect.setAttribute('width', bw * 0.7);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', 3);
    rect.setAttribute('class', 'bar');
    const tip = document.createElementNS(NS, 'title');
    tip.textContent = `${dateText(d.day)}: promedio ${money(d.avg, cur)} (${d.count} pub.)`;
    rect.append(tip);
    svg.append(rect);
    if (series.length <= 8 || i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 6) === 0) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', P + i * bw + bw / 2);
      label.setAttribute('y', H - 6);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = shortDay(d.day);
      svg.append(label);
    }
  });
  return svg;
}

// Contacto tal como lo publicó el vendedor. Si parece un teléfono, se ofrece como enlace de llamada.
function sellerContact(value) {
  const digits = value.replace(/[^\d+]/g, '');
  const looksLikePhone = /^\+?\d{6,}$/.test(digits);
  return el('div', { class: 'seller' }, 'Contacto: ', looksLikePhone ? el('a', { href: `tel:${digits}`, text: value }) : value);
}

function postCard(p) {
  const specs = [p.brand, p.model].filter(Boolean).join(' · ');
  return el(
    'article',
    { class: 'post' },
    p.image_url ? el('img', { class: 'thumb', src: p.image_url, alt: p.product, loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'thumb', 'aria-hidden': 'true' }),
    el(
      'div',
      { class: 'body' },
      el('div', { class: 'price', text: money(p.price, p.currency) }),
      el('h3', { text: p.product }),
      specs ? el('div', { class: 'meta', text: `Marca y modelo: ${specs}` }) : null,
      el('div', { class: 'meta', text: [p.municipality, p.province].filter(Boolean).join(' · ') }),
      el('div', { class: 'meta', text: `${dateText(p.published_at)} · ${p.category || 'Otros'}` }),
      p.description ? el('div', { class: 'desc', text: p.description }) : null,
      el('div', { class: 'seller', text: p.seller ? `Vendedor: ${p.seller}` : 'Vendedor: no indicado en la fuente' }),
      p.seller_contact ? sellerContact(p.seller_contact) : null,
      el('div', { class: 'meta', text: `Grupo: ${p.group_name}` }),
      el(
        'div',
        { class: 'row', style: 'margin-top:auto' },
        p.source_url
          ? el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'Ver publicación original' })
          : el('span', { class: 'badge warn', text: 'Sin enlace de origen' }),
        el('a', { href: p.group_url, target: '_blank', rel: 'noopener noreferrer', text: 'Ver grupo' }),
      ),
    ),
  );
}

// Contador y botón "Cargar más" a partir de la respuesta de búsqueda
function updateCount(data) {
  state.search.nextOffset = data.next_offset;
  const shown = data.next_offset ?? data.total;
  $('count-text').textContent = data.total ? `Mostrando ${shown} de ${data.total}` : '0 resultados';
  $('more-wrap').replaceChildren();
  if (data.next_offset !== null) {
    const remaining = data.total - data.next_offset;
    $('more-wrap').append(
      el('button', { type: 'button', id: 'more-btn', class: 'secondary', text: `Cargar más (${remaining} restantes)`, onclick: () => fetchSearch(true) }),
    );
  }
}

function appendResults(data) {
  $('posts-list').append(...data.results.map(postCard));
  updateCount(data);
}

function signalCard(signals, period) {
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Señales de mercado' }),
    signals.length
      ? el(
          'div',
          { class: 'list' },
          signals.map((s) =>
            el(
              'div',
              { class: 'list-item' },
              el(
                'div',
                {},
                el('div', { class: 'title', text: s.text }),
                el('div', { class: 'signal-meta', text: `${s.evidence ?? ''} Período: ${dateText(period.start)} – ${dateText(period.end)}` }),
              ),
              el('span', { class: 'conf', text: `Confianza ${s.confidence ?? 'baja'}` }),
            ),
          ),
        )
      : el('p', { class: 'muted', style: 'margin:0', text: 'Sin señales: hacen falta más publicaciones y varios días con datos.' }),
  );
}

function outlierCard(outliers) {
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Precios atípicos' }),
    el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:0.85rem', text: 'Se alejan mucho del rango habitual de su mismo producto y moneda. Pueden ser errores de publicación; compruébalo en la fuente.' }),
    el(
      'div',
      { class: 'list' },
      outliers.map((o) =>
        el(
          'div',
          { class: 'list-item' },
          el(
            'div',
            {},
            el('div', { class: 'title', text: `${o.product} · ${money(o.price, o.currency)}` }),
            el('div', {
              class: o.direction === 'bajo' ? 'outlier-low' : 'outlier-high',
              text: `${o.direction === 'bajo' ? 'Por debajo' : 'Por encima'} de la mediana (${money(o.median, o.currency)})`,
            }),
            el('div', { class: 'muted', text: `${[o.municipality, o.province].filter(Boolean).join(', ')} · ${dateText(o.published_at)}` }),
          ),
          o.source_url ? el('a', { href: o.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'Ver' }) : null,
        ),
      ),
    ),
  );
}

function renderResults(data) {
  const { analysis: a, period, filters, total, results } = data;
  $('results').replaceChildren();
  const q = filters.q ? `Resultados para “${filters.q}”` : 'Resultados del período';
  const header = el(
    'div',
    { class: 'card' },
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { text: q }), el('span', { class: 'muted', text: `${dateText(period.start)} – ${dateText(period.end)} · ${period.days} día(s)` })),
    el('p', { class: 'muted', style: 'margin:0', text: 'Se analiza la oferta publicada en los grupos registrados. No mide la demanda real.' }),
  );

  const cards = [stat('Publicaciones', String(total), `${a.sources} grupo(s) con datos`)];
  for (const [cur, s] of Object.entries(a.prices)) {
    if (s.sufficient) {
      cards.push(stat(`Mínimo ${cur}`, money(s.min, cur)), stat(`Promedio ${cur}`, money(s.avg, cur), `Mediana ${money(s.median, cur)}`), stat(`Máximo ${cur}`, money(s.max, cur)));
    } else {
      cards.push(stat(`Precio ${cur}`, '—', `${s.count} dato(s): insuficientes`));
    }
  }

  $('results').append(header, el('div', { class: 'grid-stats' }, cards));

  if (a.warnings.length) $('results').append(el('div', {}, a.warnings.map((w) => el('div', { class: 'alert warn', text: w }))));

  $('results').append(signalCard(a.signals, period));
  if (a.outliers && a.outliers.length) $('results').append(outlierCard(a.outliers));

  const series = Object.entries(a.evolution).filter(([, s]) => s);
  const evoBody = series.length
    ? series.map(([cur, s]) => el('div', { style: 'margin-bottom:12px' }, el('div', { class: 'muted', text: `Precio medio diario · ${cur}` }), evolutionChart(s, cur)))
    : el('p', { class: 'muted', style: 'margin:0', text: `Se necesitan publicaciones en al menos ${state.config.minDistinctDays} días distintos.` });
  $('results').append(el('div', { class: 'card' }, el('h3', { text: 'Evolución de precios' }), evoBody));

  $('results').append(
    el(
      'div',
      { class: 'dist-grid' },
      el('div', { class: 'card', style: 'margin:0' }, el('h3', { text: 'Por provincia' }), barList(a.distribution.byProvince, 'key', 16)),
      el('div', { class: 'card', style: 'margin:0' }, el('h3', { text: 'Por municipio' }), barList(a.distribution.byMunicipality.filter((m) => m.key))),
      el('div', { class: 'card', style: 'margin:0' }, el('h3', { text: 'Por grupo' }), barList(a.distribution.byGroup)),
    ),
  );

  const list = el(
    'div',
    { class: 'posts', id: 'posts-list' },
    results.length ? results.map(postCard) : el('p', { class: 'muted', text: 'No hay publicaciones con estos filtros y período.' }),
  );
  $('results').append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, el('h3', { style: 'margin:0', text: 'Publicaciones' }), el('span', { class: 'muted', id: 'count-text' })),
      list,
      el('div', { id: 'more-wrap', style: 'margin-top:12px' }),
    ),
  );
  updateCount(data);
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- inicio ----------
async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');
    renderDashboard(data);
  } catch (err) {
    $('dash-market').replaceChildren(el('div', { class: 'alert error', role: 'alert', text: err.message }));
  }
}

const filtersText = (s) => [s.filters?.brand, s.filters?.model, s.filters?.province, s.filters?.municipality, s.filters?.category, `${s.period.days} día(s) hasta ${dateText(s.period.end)}`].filter(Boolean).join(' · ');

function priceSummaryText(prices) {
  const parts = Object.entries(prices || {}).map(([cur, s]) =>
    s.sufficient ? `${cur}: promedio ${money(s.avg, cur)}, mediana ${money(s.median, cur)}` : `${cur}: ${s.count} dato(s), insuficientes`,
  );
  return parts.length ? parts.join(' · ') : 'Sin precios para estadística';
}

function openPeriod(period) {
  $('q').value = '';
  $('brand').value = '';
  $('model').value = '';
  $('sort').value = 'fecha_desc';
  $('province').value = '';
  loadMunicipalities('');
  $('category').value = '';
  $('days').value = String(period.days);
  $('end').value = period.end;
  setView('buscar');
  runSearch(collectFilters());
}

function searchProduct(name) {
  $('q').value = name;
  $('brand').value = '';
  $('model').value = '';
  $('sort').value = 'fecha_desc';
  $('days').value = String(state.config.maxPeriodDays);
  $('end').value = todayHavana();
  setView('buscar');
  runSearch(collectFilters());
}

function renderDashboard(d) {
  const m = d.market;
  $('dash-period').textContent = `${dateText(d.period.start)} – ${dateText(d.period.end)}`;

  $('dash-market').replaceChildren(
    stat('Publicaciones', String(m.posts_total), m.coverage_from ? `Desde ${dateText(m.coverage_from)}` : 'Sin datos aún'),
    stat('Últimos 7 días', String(m.posts_last_7_days), 'publicaciones observadas'),
    stat('Últimos 30 días', String(m.posts_period), `${m.provinces_in_period} provincia(s)`),
    stat('Grupos con datos', String(m.groups_with_data), 'grupos activos'),
  );

  const recent = d.recent_searches || [];
  $('dash-recent').replaceChildren(
    ...(recent.length
      ? recent.map((s) => el('button', { type: 'button', class: 'secondary chip', text: `${s.q || 'Sin texto'} · ${s.period.days} d`, onclick: () => repeatSearch(s) }))
      : [el('p', { class: 'empty', text: 'Todavía no has hecho búsquedas.' })]),
  );

  const analyses = recent.filter((s) => s.summary);
  $('dash-analyses').replaceChildren(
    ...(analyses.length
      ? analyses.map((s) =>
          el(
            'div',
            { class: 'list-item' },
            el('div', {}, el('div', { class: 'title', text: s.q || '(sin texto)' }), el('div', { class: 'muted', text: filtersText(s) }), el('div', { class: 'muted', text: `${s.total} resultado(s) · ${priceSummaryText(s.summary.prices)}` })),
            el('button', { type: 'button', class: 'small secondary', text: 'Repetir', onclick: () => repeatSearch(s) }),
          ),
        )
      : [el('p', { class: 'empty', text: 'Los análisis aparecerán aquí cuando hagas búsquedas.' })]),
  );

  $('dash-signals').replaceChildren(
    ...(d.signals.length
      ? d.signals.map((s) =>
          el(
            'div',
            { class: 'list-item' },
            el(
              'div',
              {},
              el('div', { class: 'title', text: s.text }),
              el('div', { class: 'signal-meta', text: `${s.evidence ?? ''} Período: ${dateText(s.period.start)} – ${dateText(s.period.end)}` }),
              el('span', { class: 'conf', text: `Confianza ${s.confidence ?? 'baja'}` }),
            ),
            el('button', { type: 'button', class: 'small secondary', text: 'Ver análisis', onclick: () => openPeriod(s.period) }),
          ),
        )
      : [el('p', { class: 'empty', text: 'Sin señales: hacen falta más publicaciones y varios días con datos.' })]),
  );

  const minDays = state.config?.minDistinctDays ?? 2;
  $('dash-evolution').replaceChildren(
    d.evolution && d.primary_currency
      ? el('div', {}, el('div', { class: 'muted', text: `Precio medio diario · ${d.primary_currency}` }), evolutionChart(d.evolution, d.primary_currency))
      : el('p', { class: 'empty', text: `Se necesitan publicaciones en al menos ${minDays} días distintos del último mes.` }),
  );

  $('dash-featured').replaceChildren(
    ...(d.featured.length
      ? d.featured.map((f) => {
          const cur = Object.entries(f.byCurrency);
          const priceLine = cur.length
            ? cur.map(([c, s]) => `${c}: mediana ${money(s.median, c)}`).join(' · ')
            : 'Pocos precios para estadística';
          return el(
            'div',
            { class: 'list-item' },
            el('div', {}, el('div', { class: 'title', text: f.name }), el('div', { class: 'muted', text: `${f.posts} publicación(es) en ${f.groups} grupo(s)` }), el('div', { class: 'muted', text: priceLine })),
            el('button', { type: 'button', class: 'small secondary', text: 'Buscar', onclick: () => searchProduct(f.name) }),
          );
        })
      : [el('p', { class: 'empty', text: 'Ningún producto aparece en al menos 2 publicaciones del último mes.' })]),
  );

  $('dash-provinces').replaceChildren(
    ...(d.provinces.length
      ? d.provinces.map((p) =>
          el(
            'div',
            { class: 'list-item' },
            el('div', {}, el('div', { class: 'title', text: p.province }), el('div', { class: 'muted', text: `${p.posts} publicación(es)` })),
            el('div', { class: 'muted', text: p.avg != null ? `${money(p.avg, p.currency)} promedio` : 'Sin precio suficiente' }),
          ),
        )
      : [el('p', { class: 'empty', text: 'Sin publicaciones en el último mes.' })]),
  );

  $('dash-activity').replaceChildren(
    ...(d.activity.length
      ? d.activity.map((a) =>
          el(
            'div',
            { class: 'list-item' },
            el('div', {}, el('div', { class: 'title', text: a.group_name }), el('div', { class: 'muted', text: `Carga del ${dateText(a.day)} · ${a.inserted ?? 0} nueva(s) de ${a.received ?? 0}` })),
            el('span', { class: 'badge', text: `${a.duplicates ?? 0} repetida(s)` }),
          ),
        )
      : [el('p', { class: 'empty', text: 'Todavía no hay cargas registradas.' })]),
  );
}

// ---------- grupos ----------
async function loadGroups() {
  const list = $('groups-list');
  list.replaceChildren(el('div', { class: 'skeleton' }));
  try {
    const { groups } = await api('/api/groups');
    state.groups = groups;
    list.replaceChildren();
    if (!groups.length) list.append(el('p', { class: 'muted', text: 'Aún no hay grupos registrados. Agrega el primero arriba.' }));
    for (const g of groups) {
      list.append(
        el(
          'div',
          { class: 'list-item' },
          el('div', {}, el('div', { class: 'title', text: g.name }), el('div', { class: 'muted', text: `${g.posts} publicación(es)` })),
          el('div', { class: 'row' }, el('span', { class: `badge ${g.status === 'activo' ? 'ok' : 'warn'}`, text: g.status === 'activo' ? 'Activo' : 'Pausado' }), el('a', { href: g.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' })),
        ),
      );
    }
  } catch (err) {
    list.replaceChildren(el('div', { class: 'alert error', text: err.message }));
  }
}

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('group-name').value.trim();
  const url = $('group-url').value.trim();
  if (name.length < 3) return toast('El nombre del grupo debe tener al menos 3 caracteres.');
  if (!url) return toast('Escribe el enlace del grupo.');
  try {
    await api('/api/groups', { method: 'POST', body: { name, url } });
    e.target.reset();
    toast('Grupo agregado.');
    loadGroups();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- historial ----------
async function loadHistory() {
  const list = $('history-list');
  list.replaceChildren(el('div', { class: 'skeleton' }));
  try {
    const { searches } = await api('/api/searches');
    list.replaceChildren();
    if (!searches.length) list.append(el('p', { class: 'muted', text: 'Todavía no has hecho búsquedas.' }));
    for (const s of searches) {
      list.append(
        el(
          'div',
          { class: 'list-item' },
          el('div', {}, el('div', { class: 'title', text: s.q || '(sin texto)' }), el('div', { class: 'muted', text: `${filtersText(s)} · ${s.total} resultado(s)` })),
          el(
            'div',
            { class: 'row' },
            el('button', { type: 'button', class: 'small', text: 'Repetir', onclick: () => repeatSearch(s) }),
            el('button', { type: 'button', class: 'small secondary', text: 'Borrar', onclick: () => deleteSearch(s.id) }),
          ),
        ),
      );
    }
  } catch (err) {
    list.replaceChildren(el('div', { class: 'alert error', text: err.message }));
  }
}

async function repeatSearch(s) {
  $('q').value = s.q || '';
  $('brand').value = s.filters.brand || '';
  $('model').value = s.filters.model || '';
  $('sort').value = s.filters.sort || 'fecha_desc';
  $('province').value = s.filters.province || '';
  await loadMunicipalities(s.filters.province, s.filters.municipality);
  $('category').value = s.filters.category || '';
  $('days').value = String(s.period.days);
  $('end').value = s.period.end;
  setView('buscar');
  runSearch(collectFilters());
}

async function deleteSearch(id) {
  try {
    await api(`/api/searches/${id}`, { method: 'DELETE', body: {} });
    loadHistory();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- reportes ----------
$('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = $('report-message').value.trim();
  if (message.length < 10) return toast('El mensaje debe tener al menos 10 caracteres.');
  try {
    await api('/api/reports', { method: 'POST', body: { type: $('report-type').value, message } });
    e.target.reset();
    toast('Gracias. Tu mensaje fue enviado.');
  } catch (err) {
    toast(err.message);
  }
});

// ---------- arranque ----------
(async function boot() {
  try {
    const { user } = await api('/api/me');
    if (!user) throw new Error('Sin sesión.');
    state.user = user;
    await enterApp();
  } catch {
    showAuth();
    setAuthMode('login');
  }
})();
