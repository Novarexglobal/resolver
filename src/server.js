import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { SupabaseStore } from './supabase-store.js';
import {
  config,
  PROVINCES,
  DEFAULT_CATEGORIES,
  CURRENCIES,
  MAX_PERIOD_DAYS,
  MIN_OBSERVATIONS,
  MIN_DISTINCT_DAYS,
} from './config.js';
import {
  ROLES,
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  createSession,
  getUserFromRequest,
  destroySession,
  sessionCookie,
  clearCookie,
  loginAllowed,
  recordFailure,
  clearFailures,
} from './auth.js';
import { analyze, resolvePeriod, filterPosts, dedupe, monthlySummary, todayISO, isDay } from './analysis.js';
import { validateBatch, validatePost, parseImport } from './ingest.js';
import { HttpError, sendJson, readJson, serveStatic, securityHeaders } from './http.js';

const MAX_RESULTS = 200;
const GROUP_STATUSES = ['activo', 'pausado'];
const REPORT_STATUSES = ['abierto', 'revisado', 'cerrado'];
const REPORT_TYPES = ['incidencia', 'sugerencia'];
// Hash de referencia para igualar el tiempo de respuesta cuando el usuario no existe
const DUMMY_HASH = hashPassword('referencia-no-usada-000');
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, disabled: !!u.disabled, created_at: u.created_at });

const publicPost = (p) => ({
  id: p.id,
  product: p.product,
  price: p.price,
  currency: p.currency,
  province: p.province,
  municipality: p.municipality,
  category: p.category,
  published_at: p.published_at,
  description: p.description,
  source_url: p.source_url,
  image_url: p.image_url,
  group_name: p.group_name,
  group_url: p.group_url,
});

/** Valida y canonicaliza un enlace de grupo de Facebook. */
export function canonicalGroupUrl(value) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    throw new HttpError(400, 'El enlace del grupo no es válido.');
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (u.protocol !== 'https:' || (host !== 'facebook.com' && host !== 'fb.com')) {
    throw new HttpError(400, 'El enlace debe ser de Facebook (https://www.facebook.com/groups/...).');
  }
  if (!/^\/groups\/[^/]+/.test(u.pathname)) {
    throw new HttpError(400, 'El enlace debe apuntar a un grupo (contener /groups/).');
  }
  return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}`;
}

export function createApp(store, options = {}) {
  const cfg = { ...config, ...options };

  if (!store.list('categories').length) {
    for (const name of DEFAULT_CATEGORIES) store.insert('categories', { name });
  }

  const routes = [];
  const add = (method, path, handler) => {
    const re = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
    routes.push({ method, re, handler });
  };

  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Debes iniciar sesión.');
    return ctx.user;
  };
  const requireSuper = (ctx) => {
    requireUser(ctx);
    if (ctx.user.role !== ROLES.SUPERADMIN) throw new HttpError(403, 'Acceso restringido al administrador.');
  };
  const groupsById = () => new Map(store.list('groups').map((g) => [g.id, g]));
  // Cobertura y última carga de cada grupo, calculadas desde los datos reales
  const groupView = (g) => {
    const posts = store.list('posts', (p) => p.group_id === g.id);
    const dates = posts.map((p) => p.published_at).sort();
    const lastImport = store.list('imports', (i) => i.group_id === g.id).slice(-1)[0];
    return {
      ...g,
      posts: posts.length,
      coverage_from: dates[0] || null,
      coverage_to: dates[dates.length - 1] || null,
      last_import_at: lastImport ? lastImport.created_at : null,
      last_import_day: lastImport ? lastImport.day : null,
    };
  };

  // ---------- Público ----------
  add('GET', '/api/config', (ctx) => {
    ctx.json(200, {
      provinces: PROVINCES,
      categories: store.list('categories').map((c) => c.name),
      currencies: CURRENCIES,
      maxPeriodDays: MAX_PERIOD_DAYS,
      minObservations: MIN_OBSERVATIONS,
      minDistinctDays: MIN_DISTINCT_DAYS,
    });
  });

  // Salud del servicio: para el hosting y para ver si hay escrituras pendientes en Supabase
  add('GET', '/api/health', (ctx) => {
    ctx.json(200, { ok: true, storage: store instanceof SupabaseStore ? 'supabase' : 'archivo', ...store.status() });
  });

  // Sin sesión responde 200 con user null: no es un error, es el estado normal al abrir la app
  add('GET', '/api/me', (ctx) => {
    ctx.json(200, { user: ctx.user ? publicUser(ctx.user) : null });
  });

  // ---------- Autenticación ----------
  add('POST', '/api/auth/register', async (ctx) => {
    const body = await readJson(ctx.req);
    const username = String(body.username ?? '').trim().toLowerCase();
    if (!validateUsername(username)) {
      throw new HttpError(400, 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
    }
    if (!validatePassword(body.password)) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.');
    if (store.get('users', (u) => u.username === username)) throw new HttpError(409, 'Ese nombre de usuario ya está en uso.');
    // El registro público siempre crea usuarios normales. El superadministrador solo se crea por consola.
    const user = store.insert('users', {
      username,
      password_hash: hashPassword(body.password),
      role: ROLES.USER,
      disabled: false,
    });
    const s = createSession(store, user.id, cfg.sessionDays);
    ctx.json(201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(s.token, s.expires_at, cfg.secureCookies) });
  });

  add('POST', '/api/auth/login', async (ctx) => {
    const body = await readJson(ctx.req);
    const username = String(body.username ?? '').trim().toLowerCase();
    const key = `${ctx.ip}|${username}`;
    if (!loginAllowed(key)) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
    const user = store.get('users', (u) => u.username === username);
    const valid = verifyPassword(String(body.password ?? ''), user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      recordFailure(key);
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    if (user.disabled) throw new HttpError(403, 'Esta cuenta está desactivada.');
    clearFailures(key);
    const s = createSession(store, user.id, cfg.sessionDays);
    ctx.json(200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(s.token, s.expires_at, cfg.secureCookies) });
  });

  add('POST', '/api/auth/logout', (ctx) => {
    destroySession(store, ctx.req);
    ctx.json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
  });

  // ---------- Grupos (usuarios) ----------
  add('GET', '/api/groups', (ctx) => {
    requireUser(ctx);
    const groups = store.list('groups').sort((a, b) => a.name.localeCompare(b.name, 'es')).map(groupView);
    ctx.json(200, { groups });
  });

  add('POST', '/api/groups', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 120) throw new HttpError(400, 'El nombre del grupo debe tener de 3 a 120 caracteres.');
    const url = canonicalGroupUrl(body.url);
    if (store.get('groups', (g) => g.url.toLowerCase() === url.toLowerCase())) {
      throw new HttpError(409, 'Ese grupo ya está registrado.');
    }
    // Los grupos que propone un usuario quedan en solicitud hasta que el administrador los activa
    const group = store.insert('groups', { name, url, status: 'solicitado', province: '', municipality: '', added_by: ctx.user.id });
    ctx.json(201, { group: groupView(group) });
  });

  // ---------- Búsqueda y análisis ----------
  add('GET', '/api/search', (ctx) => {
    requireUser(ctx);
    const q = ctx.query;
    const text = (q.get('q') || '').trim().slice(0, 120);
    const province = q.get('province') || '';
    const municipality = (q.get('municipality') || '').trim().slice(0, 80);
    const category = q.get('category') || '';
    if (province && !PROVINCES.includes(province)) throw new HttpError(400, 'Provincia no válida.');
    if (category && !store.get('categories', (c) => c.name === category)) throw new HttpError(400, 'Categoría no válida.');
    let period;
    try {
      period = resolvePeriod({ end: q.get('end') || '', days: q.get('days') || 7 });
    } catch (err) {
      throw new HttpError(400, err.message);
    }

    const groups = groupsById();
    // Solo cuentan publicaciones de grupos activos dentro del período pedido
    const candidates = store
      .list('posts', (p) => p.published_at >= period.start && p.published_at <= period.end)
      .filter((p) => groups.get(p.group_id)?.status === 'activo')
      .map((p) => ({ ...p, group_name: groups.get(p.group_id).name, group_url: groups.get(p.group_id).url }));

    const matched = filterPosts(candidates, { q: text, province, municipality, category, start: period.start, end: period.end });
    const analysis = analyze(matched, period);
    const results = [...matched]
      .sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0))
      .slice(0, MAX_RESULTS)
      .map(publicPost);

    store.insert('searches', {
      user_id: ctx.user.id,
      q: text,
      filters: { province, municipality, category },
      period,
      total: matched.length,
    });

    ctx.json(200, {
      period,
      filters: { q: text, province, municipality, category },
      total: matched.length,
      truncated: matched.length > MAX_RESULTS,
      results,
      analysis,
    });
  });

  add('GET', '/api/municipalities', (ctx) => {
    requireUser(ctx);
    const province = ctx.query.get('province') || '';
    if (!PROVINCES.includes(province)) throw new HttpError(400, 'Provincia no válida.');
    const groups = groupsById();
    const names = new Set(
      store
        .list('posts', (p) => p.province === province && p.municipality && groups.get(p.group_id)?.status === 'activo')
        .map((p) => p.municipality),
    );
    ctx.json(200, { municipalities: [...names].sort((a, b) => a.localeCompare(b, 'es')) });
  });

  add('GET', '/api/searches', (ctx) => {
    requireUser(ctx);
    const searches = store
      .list('searches', (s) => s.user_id === ctx.user.id)
      .slice(-50)
      .reverse();
    ctx.json(200, { searches });
  });

  add('DELETE', '/api/searches/:id', (ctx) => {
    requireUser(ctx);
    const s = store.get('searches', (x) => x.id === ctx.params.id);
    if (!s || s.user_id !== ctx.user.id) throw new HttpError(404, 'Búsqueda no encontrada.');
    store.remove('searches', s.id);
    ctx.json(200, { ok: true });
  });

  // ---------- Incidencias y sugerencias (usuarios) ----------
  add('POST', '/api/reports', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    if (!REPORT_TYPES.includes(body.type)) throw new HttpError(400, 'Tipo no válido.');
    const message = String(body.message ?? '').trim();
    if (message.length < 10 || message.length > 1000) throw new HttpError(400, 'El mensaje debe tener de 10 a 1000 caracteres.');
    const report = store.insert('reports', { user_id: ctx.user.id, username: ctx.user.username, type: body.type, message, status: 'abierto' });
    ctx.json(201, { report });
  });

  // ---------- Administración (solo superadministrador) ----------
  add('GET', '/api/admin/overview', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, {
      users: store.list('users').length,
      groups: store.list('groups').length,
      activeGroups: store.list('groups', (g) => g.status === 'activo').length,
      posts: store.list('posts').length,
      searches: store.list('searches').length,
      openReports: store.list('reports', (r) => r.status === 'abierto').length,
    });
  });

  add('GET', '/api/admin/users', (ctx) => {
    requireSuper(ctx);
    const users = store.list('users').map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
    ctx.json(200, { users });
  });

  add('PATCH', '/api/admin/users/:id', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const target = store.get('users', (u) => u.id === ctx.params.id);
    if (!target) throw new HttpError(404, 'Usuario no encontrado.');
    if (target.role === ROLES.SUPERADMIN) throw new HttpError(400, 'No se puede modificar al superadministrador desde aquí.');
    if (typeof body.disabled !== 'boolean') throw new HttpError(400, 'Indica si la cuenta está desactivada.');
    const updated = store.update('users', target.id, { disabled: body.disabled });
    if (body.disabled) {
      for (const s of store.list('sessions', (x) => x.user_id === target.id)) store.remove('sessions', s.id);
    }
    ctx.json(200, { user: publicUser(updated) });
  });

  add('GET', '/api/admin/groups', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, { groups: store.list('groups').map(groupView) });
  });

  // Alta de grupo por el administrador: después se carga su historial completo
  add('POST', '/api/admin/groups', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 120) throw new HttpError(400, 'El nombre del grupo debe tener de 3 a 120 caracteres.');
    if (!PROVINCES.includes(body.province)) throw new HttpError(400, 'Selecciona la provincia del grupo.');
    const url = canonicalGroupUrl(body.url);
    if (store.get('groups', (g) => g.url.toLowerCase() === url.toLowerCase())) throw new HttpError(409, 'Ese grupo ya está registrado.');
    for (const key of ['created_on', 'history_from']) {
      if (body[key] && !isDay(body[key])) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD.');
    }
    const group = store.insert('groups', {
      name,
      url,
      province: body.province,
      municipality: String(body.municipality ?? '').trim().slice(0, 80),
      created_on: body.created_on || null,
      history_from: body.history_from || null,
      status: 'activo',
      added_by: ctx.user.id,
    });
    ctx.json(201, { group: groupView(group) });
  });

  add('PATCH', '/api/admin/groups/:id', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const group = store.get('groups', (g) => g.id === ctx.params.id);
    if (!group) throw new HttpError(404, 'Grupo no encontrado.');
    const patch = {};
    if (body.province !== undefined) {
      if (!PROVINCES.includes(body.province)) throw new HttpError(400, 'Provincia no válida.');
      patch.province = body.province;
    }
    if (body.municipality !== undefined) patch.municipality = String(body.municipality).trim().slice(0, 80);
    if (body.status === 'activo' && !(patch.province || group.province)) {
      throw new HttpError(400, 'Indica la provincia antes de activar el grupo.');
    }
    if (body.status !== undefined) {
      if (!GROUP_STATUSES.includes(body.status)) throw new HttpError(400, 'Estado no válido.');
      patch.status = body.status;
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 3 || name.length > 120) throw new HttpError(400, 'El nombre debe tener de 3 a 120 caracteres.');
      patch.name = name;
    }
    const updated = store.update('groups', group.id, patch);
    ctx.json(200, { group: groupView(updated) });
  });

  // Nada se borra: los grupos se pausan y su historial se conserva
  add('DELETE', '/api/admin/groups/:id', (ctx) => {
    requireSuper(ctx);
    throw new HttpError(403, 'Los grupos no se eliminan. Puedes pausarlos para que dejen de aparecer en las búsquedas.');
  });

  add('GET', '/api/admin/imports', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, { imports: store.list('imports').slice().reverse() });
  });

  add('GET', '/api/admin/groups/:id/history', (ctx) => {
    requireSuper(ctx);
    const group = store.get('groups', (g) => g.id === ctx.params.id);
    if (!group) throw new HttpError(404, 'Grupo no encontrado.');
    const posts = store
      .list('posts', (p) => p.group_id === group.id)
      .sort((a, b) => (a.published_at < b.published_at ? -1 : a.published_at > b.published_at ? 1 : 0));
    ctx.json(200, {
      group: groupView(group),
      total: posts.length,
      monthly: monthlySummary(posts),
      imports: store.list('imports', (i) => i.group_id === group.id).slice().reverse(),
      posts: posts.map((p) => publicPost({ ...p, group_name: group.name, group_url: group.url })),
    });
  });

  add('GET', '/api/admin/posts', (ctx) => {
    requireSuper(ctx);
    const groupId = ctx.query.get('group_id') || '';
    const groups = groupsById();
    const posts = store
      .list('posts', (p) => !groupId || p.group_id === groupId)
      .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
      .slice(0, 300)
      .map((p) => ({ ...publicPost({ ...p, group_name: groups.get(p.group_id)?.name, group_url: groups.get(p.group_id)?.url }), group_id: p.group_id }));
    ctx.json(200, { posts });
  });

  add('POST', '/api/admin/posts', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const group = store.get('groups', (g) => g.id === body.group_id);
    if (!group) throw new HttpError(400, 'Selecciona un grupo válido.');
    const { post, error } = validatePost(body, 0);
    if (error) throw new HttpError(400, error.message);
    const { fresh } = dedupe(store.list('posts'), [{ ...post, group_id: group.id }]);
    if (!fresh.length) throw new HttpError(409, 'Esa publicación ya existe en la base de datos.');
    const saved = store.insert('posts', { ...post, group_id: group.id, added_by: ctx.user.id });
    ctx.json(201, { post: saved });
  });

  add('POST', '/api/admin/imports', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req, 5 * 1024 * 1024);
    const group = store.get('groups', (g) => g.id === body.group_id);
    if (!group) throw new HttpError(400, 'Selecciona un grupo válido.');
    let rows;
    try {
      rows = parseImport(body.format === 'json' ? 'application/json' : 'text/csv', body.content);
    } catch (err) {
      throw new HttpError(400, `No se pudo leer el contenido: ${err.message}`);
    }
    const { posts, errors } = validateBatch(rows);
    const withGroup = posts.map((p) => ({ ...p, group_id: group.id }));
    const { fresh, skipped } = dedupe(store.list('posts'), withGroup);
    store.insertMany(
      'posts',
      fresh.map((p) => ({ ...p, added_by: ctx.user.id })),
    );
    // Registro permanente de la carga: quién, cuándo, qué rango y cuántas filas
    const dates = fresh.map((p) => p.published_at).sort();
    store.insert('imports', {
      group_id: group.id,
      group_name: group.name,
      user_id: ctx.user.id,
      username: ctx.user.username,
      format: body.format === 'json' ? 'json' : 'csv',
      day: todayISO(),
      received: rows.length,
      valid: posts.length,
      inserted: fresh.length,
      duplicates: skipped.length,
      error_count: errors.length,
      range_from: dates[0] || null,
      range_to: dates[dates.length - 1] || null,
    });
    ctx.json(200, {
      received: rows.length,
      valid: posts.length,
      inserted: fresh.length,
      duplicates: skipped.length,
      error_count: errors.length,
      errors: errors.slice(0, 100),
    });
  });

  // Las publicaciones cargadas son parte del historial permanente y no se borran
  add('DELETE', '/api/admin/posts/:id', (ctx) => {
    requireSuper(ctx);
    throw new HttpError(403, 'Las publicaciones no se eliminan: forman parte del historial permanente.');
  });

  add('GET', '/api/admin/categories', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, { categories: store.list('categories') });
  });

  add('POST', '/api/admin/categories', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'La categoría debe tener de 2 a 60 caracteres.');
    if (store.get('categories', (c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, 'Esa categoría ya existe.');
    }
    ctx.json(201, { category: store.insert('categories', { name }) });
  });

  add('DELETE', '/api/admin/categories/:id', (ctx) => {
    requireSuper(ctx);
    if (!store.remove('categories', ctx.params.id)) throw new HttpError(404, 'Categoría no encontrada.');
    ctx.json(200, { ok: true });
  });

  add('GET', '/api/admin/reports', (ctx) => {
    requireSuper(ctx);
    const reports = store.list('reports').slice().reverse();
    ctx.json(200, { reports });
  });

  add('PATCH', '/api/admin/reports/:id', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    if (!REPORT_STATUSES.includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    const updated = store.update('reports', ctx.params.id, { status: body.status });
    if (!updated) throw new HttpError(404, 'Reporte no encontrado.');
    ctx.json(200, { report: updated });
  });

  // ---------- Enrutador ----------
  function findRoute(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params: m.groups || {} };
    }
    return { methodNotAllowed: pathMatched };
  }

  return async function handle(req, res) {
    securityHeaders(res);
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (pathname.startsWith('/api/')) {
        const found = findRoute(req.method, pathname);
        if (!found) throw new HttpError(404, 'Ruta no encontrada.');
        if (found.methodNotAllowed) throw new HttpError(405, 'Método no permitido.');
        // Toda escritura de la API exige JSON, antes de evaluar sesión o datos
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !(req.headers['content-type'] || '').startsWith('application/json')) {
          throw new HttpError(415, 'Se esperaba contenido application/json.');
        }
        const ctx = {
          req,
          res,
          query: new URL(req.url, 'http://localhost').searchParams,
          params: found.params,
          ip: req.socket.remoteAddress,
          user: getUserFromRequest(store, req),
          json: (status, body, headers) => sendJson(res, status, body, headers),
        };
        await found.handler(ctx);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
      await serveStatic(res, cfg.publicDir, PAGES[pathname] ? `/${PAGES[pathname]}` : pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        if (res.headersSent) return;
        if (pathname.startsWith('/api/')) sendJson(res, err.status, { error: err.message });
        else {
          res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(err.message);
        }
        return;
      }
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor.' });
    }
  };
}

export async function createStore(cfg) {
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    const store = new SupabaseStore({ url: cfg.supabaseUrl, key: cfg.supabaseKey });
    await store.load();
    console.log('Almacenamiento: Supabase (permanente).');
    return store;
  }
  console.log(`Almacenamiento: archivo local ${cfg.dataFile}`);
  return new Store(cfg.dataFile);
}

/** Crea el superadministrador desde variables de entorno, solo si aún no existe ninguno. */
export function bootstrapSuperadmin(store, cfg) {
  if (store.get('users', (u) => u.role === ROLES.SUPERADMIN)) return false;
  if (!cfg.bootstrapUser || !cfg.bootstrapPassword) return false;
  const username = cfg.bootstrapUser.trim().toLowerCase();
  if (!validateUsername(username)) throw new Error('RESOLVER_ADMIN_USER no es válido (3 a 30 caracteres: letras, números, . _ -).');
  if (!validatePassword(cfg.bootstrapPassword)) throw new Error('RESOLVER_ADMIN_PASSWORD debe tener al menos 10 caracteres.');
  store.insert('users', { username, password_hash: hashPassword(cfg.bootstrapPassword), role: ROLES.SUPERADMIN, disabled: false });
  console.log(`Superadministrador "${username}" creado. Ya puedes borrar RESOLVER_ADMIN_USER y RESOLVER_ADMIN_PASSWORD.`);
  return true;
}

export async function startServer(options = {}) {
  const cfg = { ...config, ...options };
  const store = await createStore(cfg);
  bootstrapSuperadmin(store, cfg);
  const server = createServer(createApp(store, cfg));
  server.listen(cfg.port, () => console.log(`RESOLVER escuchando en el puerto ${cfg.port}`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((err) => {
    console.error(`No se pudo iniciar RESOLVER: ${err.message}`);
    process.exit(1);
  });
}
