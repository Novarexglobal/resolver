const $ = (id) => document.getElementById(id);
const state = { config: null, user: null, focusGroupId: '' };
// Moderador: contenido. Superadministrador: además usuarios, estadísticas, errores y configuración.
const CONTENT_ROLES = ['superadmin', 'moderador'];
const isSuper = () => state.user?.role === 'superadmin';
const ROLE_LABEL = { superadmin: 'Superadministrador', moderador: 'Moderador', user: 'Usuario' };

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

const money = (v, cur) => `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(v)} ${cur}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '');
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
    throw new Error('Sin conexión con el servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un error inesperado.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- acceso ----------
function showLogin(message = '') {
  state.user = null;
  $('admin-app').classList.add('hidden');
  $('admin-logout').classList.add('hidden');
  $('admin-who').textContent = '';
  $('admin-login').classList.remove('hidden');
  const box = $('admin-login-error');
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

$('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('admin-user').value.trim().toLowerCase();
  const password = $('admin-pass').value;
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    if (!CONTENT_ROLES.includes(user.role)) {
      await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      return showLogin('Esta sección es solo para el equipo de administración.');
    }
    $('admin-pass').value = '';
    await enterAdmin(user);
  } catch (err) {
    showLogin(err.message);
  }
});

$('admin-logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  showLogin();
});

async function enterAdmin(user) {
  state.user = user;
  $('admin-login').classList.add('hidden');
  $('admin-app').classList.remove('hidden');
  $('admin-logout').classList.remove('hidden');
  $('admin-who').textContent = `${user.username} · ${ROLE_LABEL[user.role]}`;
  document.querySelectorAll('[data-super]').forEach((b) => b.classList.toggle('hidden', !isSuper()));
  if (!state.config) state.config = await api('/api/config');
  showPanel('resumen');
}

// ---------- navegación ----------
const panels = {
  resumen: renderOverview,
  grupos: renderGroups,
  importar: renderImport,
  historial: renderHistory,
  manual: renderManual,
  publicaciones: renderPosts,
  senales: renderSignals,
  categorias: renderCategories,
  reportes: renderReports,
  fuentes: renderSources,
  supervision: renderSupervision,
  usuarios: renderUsers,
  estadisticas: renderStats,
  errores: renderErrors,
  configuracion: renderSettings,
};

function showPanel(name) {
  if (!panels[name] || (!isSuper() && document.querySelector(`[data-panel="${name}"][data-super]`))) name = 'resumen';
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  $('panel').replaceChildren(el('div', { class: 'skeleton' }));
  panels[name]().catch((err) => $('panel').replaceChildren(el('div', { class: 'alert error', text: err.message })));
}

document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));

function card(title, ...children) {
  return el('section', { class: 'card' }, el('h2', { text: title }), ...children);
}

function table(headers, rows) {
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: headers.length, class: 'muted', text: 'Sin registros.' }))),
    ),
  );
}

const td = (...c) => el('td', {}, ...c);
const provinceSelect = (id = '') => el('select', { id }, el('option', { value: '', text: 'Selecciona provincia' }), state.config.provinces.map((p) => el('option', { value: p, text: p })));

function statusBadge(status) {
  const map = { activo: ['ok', 'Activo'], pausado: ['warn', 'Pausado'], solicitado: ['', 'Solicitud'] };
  const [cls, text] = map[status] || ['bad', status];
  return el('span', { class: `badge ${cls}`, text });
}

// ---------- resumen ----------
async function renderOverview() {
  const [o, { groups }] = await Promise.all([api('/api/admin/overview'), api('/api/admin/groups')]);
  const today = todayHavana();
  const pendingToday = groups.filter((g) => g.status === 'activo' && g.last_import_day !== today).length;
  const requests = groups.filter((g) => g.status === 'solicitado').length;
  const stat = (label, value, cls = '') =>
    el('div', { class: `card stat ${cls}`, style: 'margin:0' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) }));
  $('panel').replaceChildren(
    card(
      'Resumen general',
      el(
        'div',
        { class: 'grid-stats' },
        stat('Grupos activos', o.activeGroups),
        stat('Publicaciones en el historial', o.posts),
        stat('Activos sin carga hoy', pendingToday),
        stat('Solicitudes de usuarios', requests),
        stat('Usuarios', o.users),
        stat('Reportes abiertos', o.openReports),
      ),
      el('p', { class: 'muted', text: `Fecha de referencia: ${today} (hora de Cuba). Las cargas del día se registran aquí.` }),
    ),
  );
}

// ---------- grupos ----------
async function renderGroups() {
  const { groups } = await api('/api/admin/groups');
  const today = todayHavana();

  // Alta de grupo: primer bloque, a la vista
  const f = {
    name: el('input', { maxlength: 120, placeholder: 'Ej.: Ventas de teléfonos La Habana' }),
    url: el('input', { type: 'url', placeholder: 'https://www.facebook.com/groups/...' }),
    province: provinceSelect(),
    municipality: el('input', { maxlength: 80, placeholder: 'Opcional' }),
    created_on: el('input', { type: 'date', title: 'Fecha en que se creó el grupo, si la conoces' }),
    history_from: el('input', { type: 'date', title: 'Desde qué fecha quieres cargar el historial' }),
  };
  const addBtn = el('button', {
    type: 'button',
    text: 'Agregar grupo y cargar su historial',
    onclick: async () => {
      addBtn.disabled = true;
      try {
        const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value.trim()]));
        const { group } = await api('/api/admin/groups', { method: 'POST', body });
        toast(`Grupo "${group.name}" agregado. Ahora carga su historial.`);
        state.focusGroupId = group.id;
        showPanel('importar');
      } catch (err) {
        toast(err.message);
      } finally {
        addBtn.disabled = false;
      }
    },
  });
  const addCard = card(
    'Agregar grupo de Facebook',
    el('p', { class: 'muted', text: 'Registra el grupo y después carga su historial desde la fecha de creación hasta hoy. Los grupos no se borran: solo se pausan.' }),
    el(
      'div',
      { class: 'form-grid' },
      el('div', {}, el('label', { text: 'Nombre del grupo' }), f.name),
      el('div', {}, el('label', { text: 'Enlace del grupo' }), f.url),
      el('div', {}, el('label', { text: 'Provincia' }), f.province),
      el('div', {}, el('label', { text: 'Municipio' }), f.municipality),
      el('div', {}, el('label', { text: 'Grupo creado el' }), f.created_on),
      el('div', {}, el('label', { text: 'Cargar historial desde' }), f.history_from),
    ),
    el('div', { style: 'margin-top:12px' }, addBtn),
  );

  // Solicitudes de usuarios
  const requests = groups.filter((g) => g.status === 'solicitado');
  const reqRows = requests.map((g) => {
    const prov = provinceSelect();
    const mun = el('input', { placeholder: 'Municipio (opcional)', maxlength: 80 });
    return el(
      'tr',
      {},
      td(el('strong', { text: g.name }), el('div', {}, el('a', { href: g.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir grupo' }))),
      td(prov),
      td(mun),
      td(
        el('button', {
          type: 'button',
          class: 'small',
          text: 'Activar',
          onclick: async () => {
            try {
              await api(`/api/admin/groups/${g.id}`, { method: 'PATCH', body: { status: 'activo', province: prov.value, municipality: mun.value } });
              toast('Grupo activado. Ahora carga su historial.');
              state.focusGroupId = g.id;
              showPanel('importar');
            } catch (err) {
              toast(err.message);
            }
          },
        }),
      ),
    );
  });
  const reqCard = requests.length ? card('Solicitudes de usuarios', table(['Grupo', 'Provincia', 'Municipio', ''], reqRows)) : null;

  // Registro de grupos con cobertura y carga diaria
  const rows = groups.filter((g) => g.status !== 'solicitado').map((g) => {
    const pending = g.status === 'activo' && g.last_import_day !== today;
    return el(
      'tr',
      {},
      td(el('strong', { text: g.name }), el('div', { class: 'muted', text: `${g.province || ''}${g.municipality ? ' · ' + g.municipality : ''}` })),
      td(g.coverage_from ? `${g.coverage_from} → ${g.coverage_to}` : el('span', { class: 'muted', text: 'Sin historial' })),
      td(g.last_import_day || el('span', { class: 'muted', text: 'Nunca' })),
      td(pending ? el('span', { class: 'badge warn', text: 'Pendiente hoy' }) : el('span', { class: 'badge ok', text: 'Al día' })),
      td(String(g.posts)),
      td(statusBadge(g.status)),
      td(
        el(
          'div',
          { class: 'row' },
          el('button', { type: 'button', class: 'small', text: 'Cargar', onclick: () => { state.focusGroupId = g.id; showPanel('importar'); } }),
          el('button', { type: 'button', class: 'small secondary', text: 'Historial', onclick: () => { state.focusGroupId = g.id; showPanel('historial'); } }),
          el('button', {
            type: 'button',
            class: 'small secondary',
            text: g.status === 'activo' ? 'Pausar' : 'Activar',
            onclick: async () => {
              await api(`/api/admin/groups/${g.id}`, { method: 'PATCH', body: { status: g.status === 'activo' ? 'pausado' : 'activo' } });
              showPanel('grupos');
            },
          }),
        ),
      ),
    );
  });

  $('panel').replaceChildren(
    addCard,
    reqCard,
    card('Grupos registrados', el('p', { class: 'muted', text: 'Cobertura: fechas con publicaciones cargadas. "Pendiente hoy" aparece en grupos activos sin carga del día.' }), table(['Grupo', 'Cobertura', 'Última carga', 'Hoy', 'Publicaciones', 'Estado', ''], rows)),
  );
}

// ---------- importar ----------
async function groupSelect(id, selected = '') {
  const { groups } = await api('/api/admin/groups');
  const usable = groups.filter((g) => g.status !== 'solicitado');
  const select = el('select', { id });
  select.append(el('option', { value: '', text: usable.length ? 'Selecciona un grupo' : 'No hay grupos activos' }));
  for (const g of usable) select.append(el('option', { value: g.id, text: g.name, selected: g.id === selected }));
  return select;
}

async function renderImport() {
  const select = await groupSelect('imp-group', state.focusGroupId);
  const format = el('select', { id: 'imp-format' }, el('option', { value: 'csv', text: 'CSV (con cabeceras)' }), el('option', { value: 'json', text: 'JSON (lista de objetos)' }), el('option', { value: 'lines', text: 'Rápido: una línea por publicación (campos separados por |)' }));
  const textarea = el('textarea', { id: 'imp-content', placeholder: 'product,price,currency,province,municipality,published_at,description,source_url\niPhone 16,950,USD,La Habana,Playa,2026-11-16,Nuevo con caja,https://www.facebook.com/groups/.../posts/...' });
  const file = el('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', id: 'imp-file' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast('El archivo supera 4 MB. Divídelo en partes.');
    textarea.value = await f.text();
    format.value = f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  });
  const result = el('div', { id: 'imp-result' });
  const submit = el('button', {
    type: 'button',
    text: 'Cargar publicaciones',
    onclick: async () => {
      if (!select.value) return toast('Selecciona el grupo.');
      if (!textarea.value.trim()) return toast('Pega el contenido o selecciona un archivo.');
      submit.disabled = true;
      submit.textContent = 'Cargando…';
      try {
        const r = await api('/api/admin/imports', { method: 'POST', body: { group_id: select.value, format: format.value, content: textarea.value } });
        result.replaceChildren(
          el('div', { class: 'alert info', text: `Recibidas: ${r.received} · Válidas: ${r.valid} · Nuevas: ${r.inserted} · Ya existían: ${r.duplicates} · Con error: ${r.error_count}` }),
          el('div', { class: 'alert info', text: 'La carga quedó registrada en el historial del grupo.' }),
          r.errors.length
            ? el('div', { class: 'alert warn' }, el('strong', { text: 'Filas con error (no se cargaron):' }), el('ul', {}, r.errors.map((x) => el('li', { text: `Fila ${x.row}: ${x.message}` }))))
            : null,
        );
        if (r.inserted) textarea.value = '';
      } catch (err) {
        result.replaceChildren(el('div', { class: 'alert error', text: err.message }));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Cargar publicaciones';
      }
    },
  });
  $('panel').replaceChildren(
    card(
      'Cargar publicaciones de un grupo',
      el('p', { class: 'muted', text: 'Copia las publicaciones que veas en el grupo, o prepara un CSV/JSON. Puedes cargar por tramos: lo ya cargado se omite y nada se borra. RESOLVER no entra a Facebook por su cuenta.' }),
      el('div', { class: 'form-grid' }, el('div', {}, el('label', { for: 'imp-group', text: 'Grupo' }), select), el('div', {}, el('label', { for: 'imp-format', text: 'Formato' }), format), el('div', {}, el('label', { for: 'imp-file', text: 'Archivo (opcional)' }), file)),
      el('div', { style: 'margin-top:12px' }, el('label', { for: 'imp-content', text: 'Contenido' }), textarea),
      el('div', { style: 'margin-top:12px' }, submit),
      result,
    ),
  );
}

// ---------- historial del grupo ----------
async function renderHistory() {
  const select = await groupSelect('his-group', state.focusGroupId);
  const box = el('div');
  select.addEventListener('change', () => loadHistory(select.value, box));
  $('panel').replaceChildren(card('Historial del grupo', el('p', { class: 'muted', text: 'Todas las publicaciones cargadas desde la creación del grupo, con precios y enlaces. Este registro es permanente.' }), el('div', { style: 'margin-bottom:12px' }, select), box));
  if (select.value) loadHistory(select.value, box);
}

async function loadHistory(groupId, box) {
  box.replaceChildren(el('div', { class: 'skeleton' }));
  const h = await api(`/api/admin/groups/${groupId}/history`);
  const g = h.group;
  const stat = (label, value) => el('div', { class: 'card stat', style: 'margin:0' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) }));
  const monthRows = h.monthly.map((m) =>
    el('tr', {}, td(m.month), td(String(m.count)), td(Object.entries(m.byCurrency).map(([cur, s]) => el('div', { text: `${cur}: ${money(s.min, cur)} – ${money(s.max, cur)} (prom. ${money(s.avg, cur)})` })))),
  );
  const importRows = h.imports.map((i) =>
    el('tr', {}, td(i.day), td(i.username), td(i.format.toUpperCase()), td(String(i.inserted)), td(String(i.duplicates)), td(String(i.error_count)), td(i.range_from ? `${i.range_from} → ${i.range_to}` : '—')),
  );
  const postRows = h.posts.map((p) =>
    el('tr', {}, td(p.published_at), td(el('strong', { text: p.product }), el('div', { class: 'muted', text: [p.municipality, p.province].filter(Boolean).join(' · ') })), td(money(p.price, p.currency)), td(p.source_url ? el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' }) : el('span', { class: 'badge warn', text: 'Sin enlace' }))),
  );
  box.replaceChildren(
    el(
      'div',
      { class: 'grid-stats', style: 'margin-bottom:12px' },
      stat('Publicaciones', h.total),
      stat('Cobertura', g.coverage_from ? `${g.coverage_from} → ${g.coverage_to}` : 'Sin datos'),
      stat('Última carga', g.last_import_day || 'Nunca'),
      stat('Cargas registradas', h.imports.length),
    ),
    el('a', { href: `/api/admin/groups/${groupId}/export`, download: '', class: 'badge', text: 'Descargar historial completo (CSV)' }),
    el('h3', { text: 'Resumen mensual' }),
    table(['Mes', 'Publicaciones', 'Precios observados'], monthRows),
    el('h3', { text: 'Registro de cargas', style: 'margin-top:16px' }),
    table(['Día', 'Usuario', 'Formato', 'Nuevas', 'Ya existían', 'Errores', 'Rango'], importRows),
    el('h3', { text: 'Todas las publicaciones', style: 'margin-top:16px' }),
    table(['Fecha', 'Producto', 'Precio', 'Fuente'], postRows),
  );
}

// ---------- publicación manual ----------
async function renderManual() {
  const { provinces, categories, currencies } = state.config;
  const group = await groupSelect('man-group', state.focusGroupId);
  const sel = (id, values) => el('select', { id }, values.map((v) => el('option', { value: v, text: v })));
  const field = (label, input) => el('div', {}, el('label', { text: label }), input);
  const f = {
    product: el('input', { maxlength: 120 }),
    price: el('input', { inputmode: 'decimal' }),
    currency: sel('man-currency', currencies),
    province: sel('man-province', provinces),
    municipality: el('input', { maxlength: 80 }),
    category: sel('man-category', categories),
    published_at: el('input', { type: 'date', max: todayHavana() }),
    description: el('textarea', { maxlength: 1000 }),
    source_url: el('input', { type: 'url', placeholder: 'https://www.facebook.com/groups/.../posts/...' }),
    image_url: el('input', { type: 'url', placeholder: 'https://… (opcional)' }),
  };
  f.published_at.value = todayHavana();
  const submit = el('button', {
    type: 'button',
    text: 'Guardar publicación',
    onclick: async () => {
      if (!group.value) return toast('Selecciona el grupo.');
      try {
        await api('/api/admin/posts', { method: 'POST', body: { group_id: group.value, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) } });
        toast('Publicación guardada en el historial.');
        for (const k of ['product', 'price', 'municipality', 'description', 'source_url', 'image_url']) f[k].value = '';
      } catch (err) {
        toast(err.message);
      }
    },
  });
  $('panel').replaceChildren(
    card(
      'Publicación individual',
      el('div', { class: 'form-grid' }, field('Grupo', group), field('Producto', f.product), field('Precio', f.price), field('Moneda', f.currency), field('Provincia', f.province), field('Municipio', f.municipality), field('Categoría', f.category), field('Fecha publicada', f.published_at)),
      el('div', { style: 'margin-top:12px' }, field('Descripción', f.description)),
      el('div', { class: 'form-grid', style: 'margin-top:12px' }, field('Enlace de la publicación', f.source_url), field('Imagen (enlace)', f.image_url)),
      el('div', { style: 'margin-top:12px' }, submit),
    ),
  );
}

// ---------- publicaciones (solo lectura) ----------
async function renderPosts() {
  const { groups } = await api('/api/admin/groups');
  const filter = el('select', { id: 'pos-group', onchange: () => loadPostRows(filter.value, tableBox) });
  filter.append(el('option', { value: '', text: 'Todos los grupos' }));
  for (const g of groups) filter.append(el('option', { value: g.id, text: g.name }));
  const tableBox = el('div');
  $('panel').replaceChildren(card('Publicaciones recientes', el('p', { class: 'muted', text: 'Las publicaciones no se editan ni se borran; solo se les puede añadir una foto. Para ver el historial completo de un grupo, usa la sección Historial.' }), el('div', { style: 'margin-bottom:12px' }, filter), tableBox));
  await loadPostRows('', tableBox);
}

const PHOTO_MAX = 2 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
    reader.readAsDataURL(file);
  });
}

// Foto: si ya tiene una, se enlaza; si no, se ofrece subirla (JPEG, PNG o WebP, máximo 2 MB)
function photoControl(p, reload) {
  if (p.image_url) return el('a', { href: p.image_url, target: '_blank', rel: 'noopener noreferrer', text: 'Ver foto' });
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': `Subir foto de ${p.product}` });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > PHOTO_MAX) {
      toast('La foto supera 2 MB.');
      input.value = '';
      return;
    }
    try {
      const content_base64 = await fileToBase64(file);
      await api(`/api/admin/posts/${encodeURIComponent(p.id)}/image`, { method: 'POST', body: { content_base64 } });
      toast('Foto subida.');
      reload();
    } catch (err) {
      toast(err.message);
      input.value = '';
    }
  });
  return input;
}

async function loadPostRows(groupId, box) {
  const { posts } = await api(`/api/admin/posts${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''}`);
  const rows = posts.map((p) =>
    el('tr', {}, td(p.published_at), td(el('strong', { text: p.product }), el('div', { class: 'muted', text: `${p.municipality || ''} ${p.province}` })), td(money(p.price, p.currency)), td(p.group_name || ''), td(p.source_url ? el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' }) : el('span', { class: 'badge warn', text: 'Sin enlace' })), td(photoControl(p, () => loadPostRows(groupId, box)))),
  );
  box.replaceChildren(table(['Fecha', 'Producto', 'Precio', 'Grupo', 'Fuente', 'Foto'], rows));
}

// ---------- usuarios ----------
async function renderUsers() {
  const { users } = await api('/api/admin/users');
  const rows = users.map((u) => {
    const pass = el('input', { type: 'password', placeholder: 'Nueva contraseña', autocomplete: 'new-password', maxlength: 200 });
    const actions = u.role === 'superadmin'
      ? el('span', { class: 'muted', text: '—' })
      : el(
          'div',
          { class: 'row' },
          pass,
          el('button', {
            type: 'button',
            class: 'small',
            text: 'Restablecer',
            onclick: async () => {
              if (pass.value.length < 10) return toast('La contraseña nueva debe tener al menos 10 caracteres.');
              if (!window.confirm(`¿Restablecer la contraseña de "${u.username}"? Se cerrarán sus sesiones abiertas.`)) return;
              try {
                await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password: pass.value } });
                toast('Contraseña restablecida. Entrégasela al usuario de forma segura.');
                pass.value = '';
              } catch (err) {
                toast(err.message);
              }
            },
          }),
          el('button', {
            type: 'button',
            class: 'small secondary',
            text: u.disabled ? 'Activar' : 'Desactivar',
            onclick: async () => {
              await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } });
              showPanel('usuarios');
            },
          }),
        );
    return el(
      'tr',
      {},
      td(el('strong', { text: u.username })),
      td(roleControl(u)),
      td(el('span', { class: `badge ${u.disabled ? 'bad' : 'ok'}`, text: u.disabled ? 'Desactivada' : 'Activa' })),
      td(when(u.created_at)),
      td(actions),
    );
  });
  $('panel').replaceChildren(card('Usuarios', table(['Usuario', 'Rol', 'Estado', 'Alta', 'Acciones'], rows)));
}

// ---------- categorías ----------
// Las categorías no se eliminan: se desactivan y dejan de ofrecerse en el buscador.
async function renderCategories() {
  const { categories, tree } = await api('/api/admin/categories');
  const roots = categories.filter((c) => c.parent === null);
  const nameInput = el('input', { id: 'cat-name', maxlength: 60, placeholder: 'Nombre de la categoría' });
  const parent = el(
    'select',
    { id: 'cat-parent' },
    el('option', { value: '', text: 'Categoría principal (nueva rama)' }),
    roots.map((r) => el('option', { value: r.name, text: `Subcategoría de ${r.name}` })),
  );
  const addBtn = el('button', {
    type: 'button',
    class: 'small',
    text: 'Agregar',
    onclick: async () => {
      try {
        await api('/api/admin/categories', { method: 'POST', body: { name: nameInput.value.trim(), parent: parent.value || null } });
        state.config = await api('/api/config');
        toast('Categoría agregada.');
        showPanel('categorias');
      } catch (err) {
        toast(err.message);
      }
    },
  });
  const categoryRow = (c, indent) =>
    el(
      'tr',
      {},
      td(el('span', { style: indent ? 'padding-left:18px' : '', text: indent ? `↳ ${c.name}` : c.name })),
      td(el('span', { class: `badge ${c.active ? 'ok' : 'warn'}`, text: c.active ? 'Activa' : 'Desactivada' })),
      td(
        el('button', {
          type: 'button',
          class: 'small secondary',
          text: c.active ? 'Desactivar' : 'Reactivar',
          onclick: async () => {
            try {
              await api(`/api/admin/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } });
              state.config = await api('/api/config');
              showPanel('categorias');
            } catch (err) {
              toast(err.message);
            }
          },
        }),
      ),
    );
  const rows = tree.flatMap((root) => [categoryRow(root, false), ...root.children.map((c) => categoryRow(c, true))]);
  $('panel').replaceChildren(
    card(
      'Categorías de producto',
      el('p', { class: 'muted', text: 'Las categorías no se eliminan: puedes desactivarlas y dejan de ofrecerse en el buscador. Las publicaciones conservan su categoría.' }),
      el(
        'div',
        { class: 'form-grid', style: 'margin-bottom:12px' },
        el('div', {}, el('label', { text: 'Nombre' }), nameInput),
        el('div', {}, el('label', { text: 'Ubicación' }), parent),
        el('div', {}, addBtn),
      ),
      table(['Categoría', 'Estado', ''], rows),
    ),
  );
}

// ---------- rol de usuario (superadministrador) ----------
function roleControl(u) {
  if (u.role === 'superadmin') return el('span', { class: 'badge', text: ROLE_LABEL.superadmin });
  return el(
    'select',
    {
      'aria-label': `Rol de ${u.username}`,
      onchange: async (e) => {
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } });
          toast('Rol actualizado.');
        } catch (err) {
          toast(err.message);
          showPanel('usuarios');
        }
      },
    },
    [['user', 'Usuario'], ['moderador', 'Moderador']].map(([value, text]) => el('option', { value, text, selected: u.role === value })),
  );
}

// ---------- señales ----------
async function renderSignals() {
  const { signals } = await api('/api/admin/signals');
  const syncBtn = el('button', {
    type: 'button',
    class: 'small',
    text: 'Buscar señales nuevas',
    onclick: async () => {
      try {
        const r = await api('/api/admin/signals/sync', { method: 'POST', body: {} });
        toast(`Candidatas: ${r.candidates} · Nuevas: ${r.created}`);
        showPanel('senales');
      } catch (err) {
        toast(err.message);
      }
    },
  });
  const rows = signals.map((s) =>
    el(
      'tr',
      {},
      td(when(s.detected_at)),
      td(el('strong', { text: s.title || s.type }), el('div', { class: 'muted', text: s.description || '' })),
      td(s.confidence || ''),
      td(s.evidence || ''),
      td(el('span', { class: `badge ${s.status === 'activa' ? 'ok' : 'warn'}`, text: s.status })),
      td(
        el('button', {
          type: 'button',
          class: 'small secondary',
          text: s.status === 'activa' ? 'Retirar' : 'Reactivar',
          onclick: async () => {
            try {
              await api(`/api/admin/signals/${s.id}`, { method: 'PATCH', body: { status: s.status === 'activa' ? 'retirada' : 'activa' } });
              showPanel('senales');
            } catch (err) {
              toast(err.message);
            }
          },
        }),
      ),
    ),
  );
  $('panel').replaceChildren(
    card(
      'Señales detectadas',
      el('p', { class: 'muted', text: 'Son observaciones con evidencia y nivel de confianza, no hechos confirmados. Retirar una señal la oculta a los usuarios, sin borrarla.' }),
      el('div', { style: 'margin-bottom:12px' }, syncBtn),
      table(['Detectada', 'Señal', 'Confianza', 'Evidencia', 'Estado', ''], rows),
    ),
  );
}

// ---------- fuentes ----------
// Ninguna fuente aparece como conectada sin un adaptador real. Las pendientes documentan qué falta para conectarlas.
async function renderSources() {
  const { sources } = await api('/api/admin/sources');
  const key = el('input', { maxlength: 40, placeholder: 'clave-corta (ej.: mercado-x)' });
  const name = el('input', { maxlength: 120, placeholder: 'Nombre de la fuente' });
  const note = el('input', { maxlength: 500, placeholder: 'Qué falta para conectarla' });
  const addBtn = el('button', {
    type: 'button',
    class: 'small',
    text: 'Registrar fuente pendiente',
    onclick: async () => {
      try {
        await api('/api/admin/sources', { method: 'POST', body: { key: key.value.trim(), name: name.value.trim(), note: note.value.trim() } });
        toast('Fuente registrada como pendiente.');
        showPanel('fuentes');
      } catch (err) {
        toast(err.message);
      }
    },
  });
  const rows = sources.map((s) =>
    el(
      'tr',
      {},
      td(el('strong', { text: s.name }), el('div', { class: 'muted', text: s.key })),
      td(s.kind === 'manual' ? 'Carga manual' : 'Pendiente de conexión'),
      td(el('span', { class: `badge ${s.status === 'activa' ? 'ok' : 'warn'}`, text: s.status })),
      td(s.note || ''),
      td(
        s.kind === 'manual'
          ? el('button', {
              type: 'button',
              class: 'small secondary',
              text: s.status === 'activa' ? 'Pausar' : 'Activar',
              onclick: async () => {
                try {
                  await api(`/api/admin/sources/${s.id}`, { method: 'PATCH', body: { status: s.status === 'activa' ? 'pausada' : 'activa' } });
                  showPanel('fuentes');
                } catch (err) {
                  toast(err.message);
                }
              },
            })
          : el('span', { class: 'muted', text: 'Sin adaptador' }),
      ),
    ),
  );
  $('panel').replaceChildren(
    card(
      'Fuentes de datos',
      el('p', { class: 'muted', text: 'Solo la carga manual está activa. Las demás se documentan hasta tener permiso o un acuerdo de datos; no se marcan como conectadas antes.' }),
      el('div', { class: 'form-grid', style: 'margin-bottom:12px' }, el('div', {}, el('label', { text: 'Clave' }), key), el('div', {}, el('label', { text: 'Nombre' }), name), el('div', {}, el('label', { text: 'Nota' }), note), el('div', {}, addBtn)),
      table(['Fuente', 'Tipo', 'Estado', 'Nota', ''], rows),
    ),
  );
}

// ---------- supervisión de análisis ----------
async function renderSupervision() {
  const { searches } = await api('/api/admin/searches');
  const rows = searches.map((s) =>
    el(
      'tr',
      {},
      td(when(s.created_at)),
      td(s.username),
      td(s.q || '—'),
      td([s.filters?.province, s.filters?.municipality, s.filters?.category, s.filters?.brand, s.filters?.model].filter(Boolean).join(' · ') || '—'),
      td(`${s.period.days} d`),
      td(String(s.total)),
    ),
  );
  $('panel').replaceChildren(
    card('Búsquedas de usuarios', el('p', { class: 'muted', text: 'Búsquedas recientes de todos los usuarios, para supervisar el uso del servicio.' }), table(['Fecha', 'Usuario', 'Texto', 'Filtros', 'Período', 'Resultados'], rows)),
  );
}

// ---------- estadísticas (superadministrador) ----------
async function renderStats() {
  const s = await api('/api/admin/stats');
  const stat = (label, value, sub) =>
    el('div', { class: 'card stat', style: 'margin:0' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) }), sub ? el('div', { class: 'sub', text: sub }) : null);
  $('panel').replaceChildren(
    card(
      'Estadísticas del servicio',
      el(
        'div',
        { class: 'grid-stats' },
        stat('Usuarios', s.users.total, `${s.users.disabled} desactivado(s)`),
        stat('Sesiones activas', s.sessions_active),
        stat('Grupos activos', s.groups.active, `${s.groups.pending} pendiente(s) de revisión`),
        stat('Publicaciones', s.posts),
        stat('Cargas', s.imports),
        stat('Búsquedas', s.searches),
        stat('Elementos guardados', s.saves),
        stat('Señales activas', s.signals.active, `${s.signals.retired} retirada(s)`),
        stat('Reportes abiertos', s.reports.open, `${s.reports.total} en total`),
        stat('Errores registrados', s.errors),
      ),
      el('p', {
        class: 'muted',
        text: `Almacenamiento: ${s.storage === 'supabase' ? 'Supabase (permanente)' : 'archivo local'}. Correo de recuperación: ${s.recovery_mail}. Tiempo activo: ${Math.round(s.uptime_seconds / 60)} min. Node ${s.node}.`,
      }),
    ),
  );
}

// ---------- errores (superadministrador) ----------
async function renderErrors() {
  const { errors } = await api('/api/admin/errors');
  const rows = errors.map((e) => el('tr', {}, td(when(e.created_at)), td(e.kind), td(e.message), td(e.path || '—')));
  $('panel').replaceChildren(
    card('Registro de errores', el('p', { class: 'muted', text: 'Errores del servidor y avisos que requieren atención. El registro no se borra.' }), table(['Fecha', 'Tipo', 'Mensaje', 'Ruta'], rows)),
  );
}

// ---------- configuración (superadministrador) ----------
async function renderSettings() {
  const { settings } = await api('/api/admin/settings');
  const announcement = el('textarea', { id: 'set-announcement', maxlength: 300, text: settings.announcement || '' });
  const days = el(
    'select',
    { id: 'set-days' },
    [1, 7, 14, 30].map((d) => el('option', { value: String(d), text: d === 1 ? 'Solo el día elegido' : `Últimos ${d} días`, selected: settings.default_days === d })),
  );
  const saveBtn = el('button', {
    type: 'button',
    text: 'Guardar configuración',
    onclick: async () => {
      try {
        await api('/api/admin/settings', { method: 'PATCH', body: { announcement: announcement.value.trim(), default_days: Number(days.value) } });
        state.config = await api('/api/config');
        toast('Configuración guardada.');
      } catch (err) {
        toast(err.message);
      }
    },
  });
  $('panel').replaceChildren(
    card(
      'Configuración',
      el('label', { text: 'Aviso para todos los usuarios (vacío = sin aviso)' }),
      announcement,
      el('div', { class: 'form-grid', style: 'margin-top:12px' }, el('div', {}, el('label', { text: 'Período por defecto de la app' }), days)),
      el('div', { style: 'margin-top:12px' }, saveBtn),
    ),
    card(
      'Copia de seguridad',
      el('p', { class: 'muted', text: 'Descarga todo el contenido en JSON: grupos, publicaciones, cargas, señales, categorías, fuentes y reportes. No incluye contraseñas, sesiones ni tokens de recuperación. Guárdala fuera de la app.' }),
      el('a', { href: '/api/admin/backup', text: 'Descargar copia completa (JSON)' }),
    ),
  );
}

// ---------- reportes ----------
async function renderReports() {
  const { reports } = await api('/api/admin/reports');
  const rows = reports.map((r) => {
    const status = el('select', {
      onchange: async () => {
        try {
          await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: { status: status.value } });
          toast('Estado actualizado.');
        } catch (err) {
          toast(err.message);
        }
      },
    });
    for (const s of ['abierto', 'revisado', 'cerrado']) status.append(el('option', { value: s, text: s, selected: s === r.status }));
    return el('tr', {}, td(when(r.created_at)), td(r.type), td(r.username), td(r.message), td(status));
  });
  $('panel').replaceChildren(card('Incidencias y sugerencias', table(['Fecha', 'Tipo', 'Usuario', 'Mensaje', 'Estado'], rows)));
}

// ---------- arranque ----------
(async function boot() {
  try {
    const { user } = await api('/api/me');
    if (!user || !CONTENT_ROLES.includes(user.role)) return showLogin();
    await enterAdmin(user);
  } catch {
    showLogin();
  }
})();
