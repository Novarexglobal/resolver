const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = { config: null, user: null, info: null, search: null, explored: false };
let authMode = 'login';
let resetToken = '';
let historyCache = [];
let compareSel = [];
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
const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const dateText = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const shortDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) : '');
const dateTimeText = (iso) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Havana' }) : '');
// Hoy en Cuba, no en UTC: después de las 7 p. m. en Cuba la fecha UTC ya es del día siguiente
const todayHavana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const ROLE_LABEL = { superadmin: 'Administrador', moderador: 'Moderador', user: 'Usuario' };
const CONTENT_ROLES = ['superadmin', 'moderador'];
const EXPLORE_TITLES = {
  movimiento_precio: 'Movimiento de precio',
  presencia_creciente: 'Presencia creciente',
  aumento_disponibilidad: 'Aumento de disponibilidad',
  disminucion_publicaciones: 'Disminución de publicaciones',
  precio_inusualmente_bajo: 'Precio inusualmente bajo',
  precio_inusualmente_alto: 'Precio inusualmente alto',
  oportunidad_potencial: 'Oportunidad potencial',
  tendencia_precio: 'Tendencia de precio',
  diferencia_provincias: 'Diferencia entre provincias',
  concentracion_fuente: 'Concentración en una fuente',
};
const KIND_LABEL = { analysis: 'Análisis', search: 'Búsqueda', signal: 'Señal' };

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  // Toda escritura declara JSON, aunque no lleve cuerpo: el servidor lo exige
  if (method !== 'GET') opts.headers['Content-Type'] = 'application/json';
  if (body !== undefined) opts.body = JSON.stringify(body);
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

// ---------- tema ----------
// Automático sigue al sistema; claro y oscuro se fuerzan con data-theme
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'oscuro') root.setAttribute('data-theme', 'dark');
  else if (theme === 'claro') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

// ---------- acceso: entrar, crear cuenta, recuperar y definir contraseña ----------
function setAuthMode(mode) {
  authMode = mode;
  const tabs = mode === 'login' || mode === 'register';
  $('auth-tabs').classList.toggle('hidden', !tabs);
  document.querySelectorAll('#auth-tabs [data-auth]').forEach((b) => b.classList.toggle('active', b.dataset.auth === mode));
  $('auth-user-wrap').classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
  $('auth-email-wrap').classList.toggle('hidden', mode !== 'forgot');
  $('auth-pass-wrap').classList.toggle('hidden', mode === 'forgot');
  $('auth-forgot').parentElement.classList.toggle('hidden', mode !== 'login');
  $('auth-back-wrap').classList.toggle('hidden', mode === 'login' || mode === 'register');
  $('auth-submit').textContent = { login: 'Entrar', register: 'Crear cuenta', forgot: 'Enviar enlace', reset: 'Guardar contraseña' }[mode];
  $('auth-pass-label').textContent = mode === 'reset' ? 'Nueva contraseña' : 'Contraseña';
  $('auth-pass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('auth-hint').textContent = mode === 'register' || mode === 'reset' ? 'Mínimo 10 caracteres.' : '';
  $('auth-error').classList.add('hidden');
  $('auth-info').classList.add('hidden');
}

function showAuth() {
  state.user = null;
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
  setAuthMode('login');
}

function showAuthError(message) {
  $('auth-info').classList.add('hidden');
  $('auth-error').textContent = message;
  $('auth-error').classList.remove('hidden');
}

function showAuthInfo(message) {
  $('auth-error').classList.add('hidden');
  $('auth-info').textContent = message;
  $('auth-info').classList.remove('hidden');
}

document.querySelectorAll('#auth-tabs [data-auth]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));
$('auth-forgot').addEventListener('click', () => setAuthMode('forgot'));
$('auth-back').addEventListener('click', () => setAuthMode('login'));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').classList.add('hidden');
  const btn = $('auth-submit');
  btn.disabled = true;
  try {
    if (authMode === 'forgot') {
      const email = $('auth-email').value.trim().toLowerCase();
      if (!email) return showAuthError('Escribe el correo de tu cuenta.');
      const data = await api('/api/auth/forgot', { method: 'POST', body: { email } });
      return showAuthInfo(data.message);
    }
    if (authMode === 'reset') {
      const password = $('auth-pass').value;
      if (password.length < 10) return showAuthError('La contraseña debe tener al menos 10 caracteres.');
      const data = await api('/api/auth/reset', { method: 'POST', body: { token: resetToken, password } });
      resetToken = '';
      history.replaceState({}, '', '/');
      $('auth-pass').value = '';
      setAuthMode('login');
      return showAuthInfo(data.message);
    }
    const username = $('auth-user').value.trim().toLowerCase();
    const password = $('auth-pass').value;
    if (!username || !password) return showAuthError('Completa usuario y contraseña.');
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

$('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* sesión ya cerrada */ }
  showAuth();
});

async function enterApp() {
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent = state.user.username;
  $('admin-link').classList.toggle('hidden', !CONTENT_ROLES.includes(state.user.role));
  applyTheme(state.user.preferences?.theme);
  try {
    await loadConfig();
  } catch (err) {
    toast(err.message);
  }
  applyPreferences();
  if (!state.info) loadInfo();
  setView('inicio');
}

// ---------- configuración, filtros y preferencias ----------
async function loadConfig() {
  state.config = await api('/api/config');
  const { maxPeriodDays, announcement } = state.config;
  fillProvinces($('province'));
  fillProvinces($('ex-province'));
  fillCategories($('category'));
  fillCategories($('ex-category'));
  $('days').querySelector('option[value="30"]').textContent = `Últimos ${maxPeriodDays} días`;
  $('announcement').textContent = announcement || '';
  $('announcement').classList.toggle('hidden', !announcement);
  const today = todayHavana();
  $('end').max = today;
  $('end').value = today;
}

function fillProvinces(select, selected = '') {
  select.replaceChildren(el('option', { value: '', text: select.id === 'pf-province' ? 'Ninguna' : 'Todas' }));
  for (const p of state.config.provinces) select.append(el('option', { value: p, text: p }));
  select.value = selected || '';
}

// Categorías con sus subcategorías agrupadas por rama; elegir una rama incluye todas sus subcategorías
function fillCategories(select) {
  select.replaceChildren(el('option', { value: '', text: 'Todas' }));
  for (const root of state.config.category_tree) {
    if (root.children.length) {
      select.append(
        el(
          'optgroup',
          { label: root.name },
          el('option', { value: root.name, text: `Todo ${root.name}` }),
          root.children.map((c) => el('option', { value: c.name, text: c.name })),
        ),
      );
    } else {
      select.append(el('option', { value: root.name, text: root.name }));
    }
  }
}

function applyPreferences() {
  const prefs = state.user.preferences || {};
  $('days').value = String(prefs.default_days || 7);
  $('province').value = prefs.default_province || '';
  loadMunicipalities(prefs.default_province || '');
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

async function loadInfo() {
  try {
    state.info = await api('/api/info');
  } catch {
    /* sin información: los botones "i" avisan si falta */
  }
}

// ---------- ventana de información por módulo ----------
function openInfo(key) {
  const m = state.info?.modules?.[key];
  if (!m) return toast('Información no disponible en este momento.');
  $('info-title').textContent = m.title;
  const sections = [
    ['Qué muestra', m.what],
    ['Cómo se calcula', m.how],
    ['Cómo interpretarlo', m.interpret],
    ['De dónde salen los datos', m.sources],
    ['Límites', m.limits],
  ];
  $('info-body').replaceChildren(...sections.flatMap(([heading, text]) => [el('h4', { text: heading }), el('p', { text })]));
  $('info-modal').classList.remove('hidden');
  $('info-close').focus();
}

function closeInfo() {
  $('info-modal').classList.add('hidden');
}

$('info-close').addEventListener('click', closeInfo);
$('info-modal').addEventListener('click', (e) => {
  if (e.target === $('info-modal')) closeInfo();
});
document.addEventListener('click', (e) => {
  const button = e.target.closest?.('[data-info]');
  if (button) openInfo(button.dataset.info);
});

// ---------- navegación ----------
// Grupos, Reportes y Sobre viven dentro de la pestaña Más
const SECTIONS = ['inicio', 'buscar', 'explorar', 'historial', 'grupos', 'reportes', 'sobre', 'cuenta'];
const TAB_OF = { inicio: 'inicio', buscar: 'buscar', explorar: 'explorar', historial: 'historial', cuenta: 'cuenta', grupos: 'mas', reportes: 'mas', sobre: 'mas' };

function setView(name) {
  const target = name === 'mas' ? 'grupos' : name;
  if (!SECTIONS.includes(target)) return;
  const tab = TAB_OF[target];
  for (const v of SECTIONS) $(`view-${v}`).classList.toggle('hidden', v !== target);
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
  $('mas-bar').classList.toggle('hidden', tab !== 'mas');
  document.querySelectorAll('#mas-bar [data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === target));
  if (target === 'inicio') loadDashboard();
  if (target === 'grupos') loadGroups();
  if (target === 'historial') loadHistory();
  if (target === 'explorar' && !state.explored) loadExplore();
  if (target === 'cuenta') loadAccount();
  if (target === 'sobre') renderAbout();
}

document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.go)));

// ---------- guardados ----------
async function saveItem(kind, refId) {
  try {
    await api('/api/saves', { method: 'POST', body: { kind, ref_id: refId } });
    toast('Guardado en tus elementos.');
  } catch (err) {
    toast(err.message);
  }
}

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
  state.search = { filters: f, nextOffset: null, searchId: null };
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
    else {
      state.search.searchId = data.search_id;
      renderResults(data);
    }
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

// Comparación con el mismo número de días inmediatamente anteriores
function comparisonCard(cmp) {
  const lines = [
    el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:0.85rem', text: `Período anterior: ${dateText(cmp.period.start)} – ${dateText(cmp.period.end)}.` }),
    el('p', { text: `Publicaciones: ${cmp.current_total} frente a ${cmp.previous_total} (${signed(cmp.posts_change_pct)}).` }),
  ];
  for (const [cur, x] of Object.entries(cmp.currencies || {})) {
    lines.push(
      el('p', {
        text:
          x.current.sufficient && x.previous.sufficient
            ? `Mediana ${cur}: ${money(x.current.median, cur)} frente a ${money(x.previous.median, cur)} (${signed(x.median_change_pct)}).`
            : `${cur}: no hay datos suficientes en los dos períodos para comparar precios.`,
      }),
    );
  }
  return el('div', { class: 'card' }, el('h3', { text: 'Comparación con el período anterior' }), lines);
}

function municipalityCard(list) {
  const rows = list.filter((m) => m.sufficient);
  return el(
    'div',
    { class: 'card' },
    el('h3', { text: 'Precio mediano por municipio' }),
    rows.length
      ? el(
          'div',
          { class: 'list' },
          rows.slice(0, 15).map((m) =>
            el(
              'div',
              { class: 'list-item' },
              el('div', {}, el('div', { class: 'title', text: m.municipality }), el('div', { class: 'muted', text: `${m.province} · ${m.count} publicación(es)` })),
              el('div', { class: 'muted', text: `Mediana ${money(m.median, m.currency)}` }),
            ),
          ),
        )
      : el('p', { class: 'muted', style: 'margin:0', text: 'Hacen falta al menos 3 publicaciones por municipio y moneda.' }),
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

  $('results').append(
    header,
    el(
      'div',
      { class: 'row', style: 'margin:0 0 12px' },
      data.search_id ? el('button', { type: 'button', class: 'small secondary', text: 'Guardar análisis', onclick: () => saveItem('analysis', data.search_id) }) : null,
      el('button', { type: 'button', class: 'small secondary', text: 'Qué significa esto', 'data-info': 'buscar' }),
    ),
    el('div', { class: 'grid-stats' }, cards),
  );

  if (a.warnings.length) $('results').append(el('div', {}, a.warnings.map((w) => el('div', { class: 'alert warn', text: w }))));

  if (data.comparison) $('results').append(comparisonCard(data.comparison));
  $('results').append(signalCard(a.signals, period));
  if (a.outliers && a.outliers.length) $('results').append(outlierCard(a.outliers));
  if (a.municipalities && a.municipalities.length) $('results').append(municipalityCard(a.municipalities));

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

// ---------- explorar ----------
$('explore-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadExplore();
});

async function loadExplore() {
  state.explored = true;
  const kind = $('ex-kind').value;
  const province = $('ex-province').value;
  const category = $('ex-category').value;
  if (kind === 'municipios' && !province) {
    $('explore-results').replaceChildren(el('div', { class: 'alert warn', text: 'Elige una provincia para ver sus municipios.' }));
    return;
  }
  const params = new URLSearchParams({ kind, days: $('ex-days').value });
  if (province) params.set('province', province);
  if (category) params.set('category', category);
  $('explore-results').replaceChildren(el('div', { class: 'skeleton' }));
  try {
    renderExplore(await api(`/api/explore?${params}`));
  } catch (err) {
    $('explore-results').replaceChildren(el('div', { class: 'alert error', role: 'alert', text: err.message }));
  }
}

function itemsOrEmpty(items, render, emptyText) {
  if (!items || !items.length) return el('p', { class: 'empty', text: emptyText });
  return el('div', { class: 'list' }, items.map(render));
}

function productRow(p) {
  const priceLine = Object.entries(p.byCurrency || {})
    .map(([c, s]) => (s.sufficient ? `${c}: mediana ${money(s.median, c)}` : `${c}: ${s.count} dato(s), insuficientes`))
    .join(' · ') || 'Sin precios';
  return el(
    'div',
    { class: 'list-item' },
    el('div', {}, el('div', { class: 'title', text: p.name }), el('div', { class: 'muted', text: `${p.posts} publicación(es) en ${p.groups} grupo(s)` }), el('div', { class: 'muted', text: priceLine })),
    el('button', { type: 'button', class: 'small secondary', text: 'Buscar', onclick: () => searchProduct(p.name) }),
  );
}

function categoryRow(t) {
  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      {},
      el('div', { class: 'title', text: t.name }),
      el('div', { class: 'muted', text: `${t.posts} publicación(es)` }),
      t.children.length ? el('div', { class: 'muted', style: 'font-size:0.85rem', text: t.children.map((c) => `${c.name} (${c.posts})`).join(' · ') }) : null,
    ),
  );
}

function provinceRow(p, currency) {
  return el(
    'div',
    { class: 'list-item' },
    el('div', {}, el('div', { class: 'title', text: p.province }), el('div', { class: 'muted', text: `${p.posts} publicación(es)` })),
    el('div', { class: 'muted', text: p.median != null ? `Mediana ${money(p.median, currency)}` : 'Sin precio suficiente' }),
  );
}

function municipalityRow(m) {
  return el(
    'div',
    { class: 'list-item' },
    el('div', {}, el('div', { class: 'title', text: m.municipality }), el('div', { class: 'muted', text: `${m.province} · ${m.count} publicación(es)` })),
    el('div', { class: 'muted', text: m.sufficient ? `Mediana ${money(m.median, m.currency)}` : 'Datos insuficientes' }),
  );
}

function signalRow(s, actions = []) {
  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      {},
      el('div', { class: 'title', text: s.title || EXPLORE_TITLES[s.type] || 'Señal' }),
      s.description ? el('div', { text: s.description }) : null,
      el('div', { class: 'signal-meta', text: `${s.evidence ?? ''} ${s.period ? `Período: ${dateText(s.period.start)} – ${dateText(s.period.end)}` : ''}`.trim() }),
      el('span', { class: 'conf', text: `Confianza ${s.confidence ?? 'baja'}` }),
    ),
    actions.length ? el('div', { class: 'row' }, actions) : null,
  );
}

function renderExplore(data) {
  const head = el('p', {
    class: 'muted',
    style: 'margin:0 0 6px',
    text: `${data.total_posts} publicación(es) · ${dateText(data.period.start)} – ${dateText(data.period.end)}${data.window ? ` · ${data.window}` : ''}`,
  });
  let body;
  if (data.kind === 'productos' || data.kind === 'presencia') {
    body = itemsOrEmpty(data.items, productRow, 'Ningún producto con datos en este período.');
  } else if (data.kind === 'categorias') {
    body = itemsOrEmpty(data.tops, categoryRow, 'Sin publicaciones en este período.');
  } else if (data.kind === 'provincias') {
    body = itemsOrEmpty(data.items, (p) => provinceRow(p, data.currency), 'Sin publicaciones en este período.');
  } else if (data.kind === 'municipios') {
    body = itemsOrEmpty(data.items, municipalityRow, 'Ningún municipio de esta provincia tiene publicaciones en el período.');
  } else if (data.kind === 'publicaciones') {
    body = data.items.length ? el('div', { class: 'posts' }, data.items.map(postCard)) : el('p', { class: 'empty', text: 'Sin publicaciones en este período.' });
  } else if (data.kind === 'movimientos') {
    body = itemsOrEmpty(data.items, (s) => signalRow(s), 'No hay movimientos con datos suficientes.');
  } else {
    body = itemsOrEmpty(
      data.items,
      (s) => signalRow(s, [el('button', { type: 'button', class: 'small secondary', text: 'Guardar', onclick: () => saveItem('signal', s.id) })]),
      'Todavía no hay oportunidades identificadas. Se detectan con varias provincias y datos suficientes.',
    );
  }
  $('explore-results').replaceChildren(head, body);
}

// Buscar un producto desde Explorar o desde el inicio
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
          signalRow(s, [
            el('button', { type: 'button', class: 'small secondary', text: 'Ver análisis', onclick: () => openPeriod(s.period) }),
            el('button', { type: 'button', class: 'small secondary', text: 'Guardar', onclick: () => saveItem('signal', s.id) }),
          ]),
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
const GROUP_STATUS = { activo: ['ok', 'Activo'], pausado: ['warn', 'Pausado'], solicitado: ['warn', 'Pendiente de revisión'] };

async function loadGroups() {
  const list = $('groups-list');
  list.replaceChildren(el('div', { class: 'skeleton' }));
  try {
    const { groups } = await api('/api/groups');
    list.replaceChildren();
    if (!groups.length) list.append(el('p', { class: 'muted', text: 'Aún no hay grupos. Propón el primero arriba.' }));
    for (const g of groups) {
      const [cls, label] = GROUP_STATUS[g.status] || ['warn', g.status];
      list.append(
        el(
          'div',
          { class: 'list-item' },
          el('div', {}, el('div', { class: 'title', text: g.name }), el('div', { class: 'muted', text: `${g.posts} publicación(es)` })),
          el('div', { class: 'row' }, el('span', { class: `badge ${cls}`, text: label }), el('a', { href: g.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' })),
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
    toast('Propuesta enviada. El equipo la revisará.');
    loadGroups();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- historial y guardados ----------
$('history-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadHistory();
});

$('saved-kind').addEventListener('change', loadSaved);

async function loadHistory() {
  compareSel = [];
  $('compare-result').replaceChildren();
  const list = $('history-list');
  list.replaceChildren(el('div', { class: 'skeleton' }));
  const params = new URLSearchParams();
  if ($('hist-from').value) params.set('from', $('hist-from').value);
  if ($('hist-to').value) params.set('to', $('hist-to').value);
  try {
    const { searches } = await api(`/api/searches?${params}`);
    historyCache = searches;
    renderHistory();
  } catch (err) {
    list.replaceChildren(el('div', { class: 'alert error', text: err.message }));
  }
  loadSaved();
}

function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  if (!historyCache.length) list.append(el('p', { class: 'muted', text: 'Todavía no hay búsquedas en este período.' }));
  for (const s of historyCache) {
    const selected = compareSel.some((x) => x.id === s.id);
    list.append(
      el(
        'div',
        { class: 'list-item' },
        el('div', {}, el('div', { class: 'title', text: s.q || '(sin texto)' }), el('div', { class: 'muted', text: `${filtersText(s)} · ${s.total} resultado(s)` }), el('div', { class: 'muted', text: dateTimeText(s.created_at) })),
        el(
          'div',
          { class: 'row' },
          el('button', { type: 'button', class: 'small', text: 'Repetir', onclick: () => repeatSearch(s) }),
          s.summary ? el('button', { type: 'button', class: 'small secondary', text: 'Guardar análisis', onclick: () => saveItem('analysis', s.id) }) : null,
          el('button', { type: 'button', class: 'small secondary', text: selected ? 'Quitar de comparación' : 'Comparar', onclick: () => toggleCompare(s) }),
          el('button', { type: 'button', class: 'small secondary', text: 'Borrar', onclick: () => deleteSearch(s.id) }),
        ),
      ),
    );
  }
  updateCompareButton();
}

function toggleCompare(s) {
  const i = compareSel.findIndex((x) => x.id === s.id);
  if (i >= 0) compareSel.splice(i, 1);
  else if (compareSel.length < 2) compareSel.push(s);
  else return toast('Solo puedes comparar dos búsquedas. Quita una para elegir otra.');
  $('compare-result').replaceChildren();
  renderHistory();
}

function updateCompareButton() {
  const btn = $('compare-go');
  btn.textContent = `Comparar seleccionadas (${compareSel.length}/2)`;
  btn.disabled = compareSel.length !== 2;
}

$('compare-go').addEventListener('click', async () => {
  if (compareSel.length !== 2) return;
  const [a, b] = compareSel;
  try {
    renderComparison(await api(`/api/searches/compare?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`));
  } catch (err) {
    toast(err.message);
  }
});

function renderComparison(r) {
  const side = (search, stats, cur) => `${search.q || 'Sin texto'}: ${stats?.sufficient ? `mediana ${money(stats.median, cur)}` : 'datos insuficientes'}`;
  const rows = Object.entries(r.currencies).map(([cur, c]) =>
    el(
      'div',
      { class: 'list-item' },
      el('div', {}, el('div', { class: 'title', text: cur }), el('div', { class: 'muted', text: side(r.a, c.a, cur) }), el('div', { class: 'muted', text: side(r.b, c.b, cur) })),
      el('span', { class: 'badge', text: c.median_change_pct == null ? 'Sin comparación' : `${signed(c.median_change_pct)} (B frente a A)` }),
    ),
  );
  $('compare-result').replaceChildren(
    el(
      'div',
      { class: 'card' },
      el('h3', { text: 'Comparación de búsquedas' }),
      el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:0.85rem', text: `A: ${r.a.q || 'Sin texto'} (${r.a.total} resultado(s)) · B: ${r.b.q || 'Sin texto'} (${r.b.total} resultado(s))` }),
      rows.length ? el('div', { class: 'list' }, rows) : el('p', { class: 'muted', style: 'margin:0', text: 'Ninguna de las dos tiene precios suficientes para comparar.' }),
    ),
  );
}

async function deleteSearch(id) {
  try {
    await api(`/api/searches/${id}`, { method: 'DELETE', body: {} });
    loadHistory();
  } catch (err) {
    toast(err.message);
  }
}

async function loadSaved() {
  const box = $('saved-list');
  box.replaceChildren(el('div', { class: 'skeleton' }));
  const kind = $('saved-kind').value;
  try {
    const { saves } = await api(`/api/saves${kind ? `?kind=${kind}` : ''}`);
    box.replaceChildren(
      ...(saves.length
        ? saves.map(savedRow)
        : [el('p', { class: 'empty', text: 'Todavía no guardas nada. Usa «Guardar» en un análisis o en una señal.' })]),
    );
  } catch (err) {
    box.replaceChildren(el('div', { class: 'alert error', text: err.message }));
  }
}

function savedRow(s) {
  const snap = s.snapshot || {};
  const detail = s.kind === 'signal' ? [snap.description, snap.evidence].filter(Boolean).join(' ') : snap.period ? filtersText(snap) : '';
  const actions = [];
  if (s.kind === 'signal') actions.push(el('button', { type: 'button', class: 'small secondary', text: 'Ver análisis', onclick: () => openPeriod(snap.period) }));
  else actions.push(el('button', { type: 'button', class: 'small', text: 'Abrir', onclick: () => repeatSearch(snap) }));
  actions.push(el('button', { type: 'button', class: 'small secondary', text: 'Quitar', onclick: () => removeSave(s.id) }));
  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      {},
      el('div', { class: 'muted', text: KIND_LABEL[s.kind] || s.kind }),
      el('div', { class: 'title', text: s.label || '(sin texto)' }),
      detail ? el('div', { class: 'muted', text: detail }) : null,
      s.kind === 'analysis' && snap.summary ? el('div', { class: 'muted', text: priceSummaryText(snap.summary.prices) }) : null,
      el('div', { class: 'muted', text: `Guardado el ${dateTimeText(s.created_at)}` }),
    ),
    el('div', { class: 'row' }, actions),
  );
}

async function removeSave(id) {
  try {
    await api(`/api/saves/${id}`, { method: 'DELETE', body: {} });
    loadSaved();
  } catch (err) {
    toast(err.message);
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

// ---------- cuenta ----------
async function loadAccount() {
  try {
    const [{ user }, { sessions }] = await Promise.all([api('/api/profile'), api('/api/profile/sessions')]);
    state.user = user;
    $('acc-user').textContent = `Usuario: ${user.username} · ${ROLE_LABEL[user.role] || user.role}`;
    $('pf-name').value = user.display_name || '';
    $('pf-email').value = user.email || '';
    $('pf-theme').value = user.preferences.theme;
    $('pf-days').value = String(user.preferences.default_days);
    fillProvinces($('pf-province'), user.preferences.default_province);
    renderSessions(sessions);
  } catch (err) {
    toast(err.message);
  }
}

function renderSessions(sessions) {
  $('sessions-list').replaceChildren(
    ...sessions.map((s) =>
      el(
        'div',
        { class: 'list-item' },
        el('div', {}, el('div', { class: 'title', text: `Iniciada el ${dateTimeText(s.created_at)}` }), el('div', { class: 'muted', text: `Vence el ${dateTimeText(s.expires_at)}` })),
        s.current
          ? el('span', { class: 'badge ok', text: 'Esta sesión' })
          : el('button', { type: 'button', class: 'small secondary', text: 'Cerrar', onclick: () => closeSession(s.id) }),
      ),
    ),
  );
}

async function closeSession(id) {
  try {
    await api(`/api/profile/sessions/${id}`, { method: 'DELETE', body: {} });
    toast('Sesión cerrada.');
    loadAccount();
  } catch (err) {
    toast(err.message);
  }
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user } = await api('/api/profile', {
      method: 'PATCH',
      body: {
        display_name: $('pf-name').value.trim(),
        email: $('pf-email').value.trim().toLowerCase(),
        preferences: {
          theme: $('pf-theme').value,
          default_days: Number($('pf-days').value),
          default_province: $('pf-province').value,
        },
      },
    });
    state.user = user;
    applyTheme(user.preferences.theme);
    toast('Cambios guardados.');
  } catch (err) {
    toast(err.message);
  }
});

$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = $('pw-current').value;
  const password = $('pw-new').value;
  if (password.length < 10) return toast('La contraseña nueva debe tener al menos 10 caracteres.');
  try {
    await api('/api/profile/password', { method: 'POST', body: { current, password } });
    e.target.reset();
    toast('Contraseña cambiada. Las demás sesiones se cerraron.');
    loadAccount();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- sobre RESOLVER ----------
function renderAbout() {
  const a = state.info?.about;
  if (!a) {
    $('about-body').replaceChildren(el('p', { class: 'muted', text: 'Información no disponible en este momento.' }));
    return;
  }
  $('about-body').replaceChildren(
    el('p', { text: `${a.product} · ${a.slogan}` }),
    el('p', { class: 'muted', text: `Empresa: ${a.company}. Fundador: ${a.founder}.` }),
    el('p', { text: a.description }),
    el('p', { text: a.not }),
    el('ul', {}, a.principles.map((p) => el('li', { text: p }))),
  );
  const modules = state.info.modules;
  $('about-modules').replaceChildren(
    ...Object.entries(modules).map(([key, m]) =>
      el(
        'div',
        { class: 'list-item' },
        el('div', {}, el('div', { class: 'title', text: m.title }), el('div', { class: 'muted', text: m.what })),
        el('button', { type: 'button', class: 'small secondary', text: 'Leer', 'data-info': key }),
      ),
    ),
  );
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
  resetToken = new URLSearchParams(location.search).get('reset') || '';
  try {
    const { user } = await api('/api/me');
    if (!user) throw new Error('Sin sesión.');
    state.user = user;
    await enterApp();
  } catch {
    showAuth();
    setAuthMode(resetToken ? 'reset' : 'login');
  }
})();
