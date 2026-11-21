import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Store, COLLECTIONS } from './store.js';
import { randomUUID } from 'node:crypto';
import { detectImage, objectPath, uploadImage, MAX_IMAGE_BYTES } from './storage.js';
import { SupabaseStore } from './supabase-store.js';
import { config, PROVINCES, CURRENCIES, MAX_PERIOD_DAYS, MIN_OBSERVATIONS, MIN_DISTINCT_DAYS, CATEGORY_TREE, RECOVERY_MINUTES, COUNTRIES, DEFAULT_COUNTRY, provincesOf } from './config.js';
import {
  ROLES,
  CONTENT_ROLES,
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  validateEmail,
  newToken,
  hashToken,
  createSession,
  getUserFromRequest,
  destroySession,
  sessionCookie,
  clearCookie,
  parseCookies,
  loginAllowed,
  recordFailure,
  clearFailures,
} from './auth.js';
import {
  analyze,
  resolvePeriod,
  filterPosts,
  sortPosts,
  SORTS,
  dedupe,
  monthlySummary,
  todayISO,
  isDay,
  buildDashboard,
  primaryCurrency,
  normalizeText,
} from './analysis.js';
import { validateBatch, validatePost, parseImport, parseLines } from './ingest.js';
import { HttpError, sendJson, readJson, serveStatic, securityHeaders } from './http.js';
import { classifyPost, seedCatalog, seedSources, categoryScope, PLANS } from './catalog.js';
import {
  compareWindows,
  municipalityPrices,
  syncSignals,
  exploreProducts,
  exploreCategories,
  detectCandidates,
  statsOf,
  MOVEMENT_TYPES,
  OPPORTUNITY_TYPES,
} from './insights.js';
import { sendMail } from './mail.js';
import { MODULE_INFO, ABOUT } from './info.js';
import { buildOpenApi } from './openapi.js';
import { STYLE_IDS, LOGO_IDS, normalizeVisual } from './visual.js';

const MAX_RESULTS = 200;
const GROUP_STATUSES = ['activo', 'pausado'];
const REPORT_STATUSES = ['abierto', 'revisado', 'cerrado'];
const REPORT_TYPES = ['incidencia', 'sugerencia', 'reclamacion'];
const SIGNAL_STATUSES = ['activa', 'retirada'];
const SAVE_KINDS = ['search', 'analysis', 'signal'];
const THEMES = ['auto', 'claro', 'oscuro'];
const PERIOD_CHOICES = [1, 7, 14, 30];
const EXPLORE_KINDS = ['productos', 'categorias', 'provincias', 'municipios', 'publicaciones', 'presencia', 'movimientos', 'oportunidades'];
const DEFAULT_SETTINGS = { announcement: '', default_days: 7 };
const DEFAULT_PREFS = { theme: 'auto', default_days: 7, default_province: '' };
const DAY_MS = 864e5;
const VERIFY_HOURS = 24;
// Hash de referencia para igualar el tiempo de respuesta cuando el usuario no existe
const DUMMY_HASH = hashPassword('referencia-no-usada-000');
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };
const STARTED_AT = Date.now();

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  disabled: !!u.disabled,
  created_at: u.created_at,
  email: u.email || '',
  email_verified: !!u.email_verified,
  display_name: u.display_name || '',
  preferences: { ...DEFAULT_PREFS, ...(u.preferences || {}) },
});

const publicPost = (p) => ({
  id: p.id,
  product: p.product,
  price: p.price,
  currency: p.currency,
  province: p.province,
  municipality: p.municipality,
  category: p.category,
  category_source: p.category_source || '',
  published_at: p.published_at,
  description: p.description,
  source_url: p.source_url,
  image_url: p.image_url,
  group_name: p.group_name,
  group_url: p.group_url,
  country: p.country || DEFAULT_COUNTRY,
  brand: p.brand || '',
  brand_source: p.brand_source || '',
  model: p.model || '',
  seller: p.seller || '',
  seller_contact: p.seller_contact || '',
});

const dayBefore = (day) => new Date(Date.parse(day) - DAY_MS).toISOString().slice(0, 10);
const dayOf = (iso) => todayISO(new Date(iso));

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

  seedCatalog(store);
  seedSources(store);
  if (!store.get('settings', () => true)) store.insert('settings', { ...DEFAULT_SETTINGS });

  const routes = [];
  const add = (method, path, handler) => {
    const re = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
    routes.push({ method, path, re, handler });
  };

  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Debes iniciar sesión.');
    return ctx.user;
  };
  const requireSuper = (ctx) => {
    requireUser(ctx);
    if (ctx.user.role !== ROLES.SUPERADMIN) throw new HttpError(403, 'Acceso restringido al administrador.');
  };
  // Gestión de contenido: superadministrador y moderador
  const requireContent = (ctx) => {
    requireUser(ctx);
    if (!CONTENT_ROLES.includes(ctx.user.role)) throw new HttpError(403, 'Acceso restringido al equipo de administración.');
  };
  const groupsById = () => new Map(store.list('groups').map((g) => [g.id, g]));
  const settings = () => store.get('settings', () => true);
  const sessionOf = (req) => {
    const token = parseCookies(req.headers.cookie).resolver_session;
    return token ? store.get('sessions', (s) => s.token_hash === hashToken(token)) : null;
  };
  const recordError = (kind, message, extra = {}) => {
    store.insert('errors', { kind, message: String(message).slice(0, 500), ...extra });
  };
  // Publicaciones de grupos activos, con el nombre y el enlace del grupo
  const activePosts = (country = DEFAULT_COUNTRY) => {
    const groups = groupsById();
    return store
      .list('posts')
      // Las publicaciones ocultas salen de búsquedas, análisis, exploración e inicio; no se borran
      .filter((p) => groups.get(p.group_id)?.status === 'activo' && p.hidden !== true && (p.country || DEFAULT_COUNTRY) === country)
      .map((p) => ({ ...p, group_name: groups.get(p.group_id).name, group_url: groups.get(p.group_id).url }));
  };
  const inDay = (p, a, b) => p.published_at >= a && p.published_at <= b;
  const categoryNames = () => new Set(store.list('categories').map((c) => c.name));
  // Árbol de categorías en el orden del módulo 7; las añadidas por el administrador van al final
  const categoryTree = (includeInactive = false) => {
    const roots = store.list('categories', (c) => c.parent === null && (includeInactive || c.active !== false));
    const order = (name) => {
      const i = CATEGORY_TREE.findIndex((t) => t.name === name);
      return i < 0 ? 999 : i;
    };
    return roots
      .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name, 'es'))
      .map((root) => ({
        name: root.name,
        id: root.id,
        active: root.active !== false,
        children: store
          .list('categories', (c) => c.parent === root.name && (includeInactive || c.active !== false))
          .map((c) => ({ name: c.name, id: c.id, active: c.active !== false }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      }));
  };
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
  const resetMailReady = () => Boolean(cfg.resendApiKey && cfg.mailFrom && cfg.appUrl);
  // Enlace de confirmación de correo (24 h, un solo uso). Sin correo configurado no crea ningún enlace.
  const sendVerification = async (user) => {
    if (!resetMailReady()) {
      recordError('verificacion', 'Se pidió confirmar un correo, pero el correo no está configurado en el servidor.', { user_id: user.id });
      return { sent: false, reason: 'El correo no está configurado en el servidor.' };
    }
    const token = newToken();
    store.insert('verifications', {
      user_id: user.id,
      email: user.email,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + VERIFY_HOURS * 60 * 60 * 1000).toISOString(),
      used: false,
    });
    const link = `${cfg.appUrl.replace(/\/+$/, '')}/?verify=${encodeURIComponent(token)}`;
    const result = await sendMail({
      apiKey: cfg.resendApiKey,
      from: cfg.mailFrom,
      to: user.email,
      subject: 'Confirma tu correo en RESOLVER',
      fetchImpl: cfg.fetchImpl,
      text: `Hola ${user.username}.\n\nPara confirmar tu correo, abre este enlace en las próximas ${VERIFY_HOURS} horas:\n${link}\n\nSi no creaste la cuenta, ignora este mensaje.`,
    });
    if (!result.sent) recordError('verificacion', result.reason, { user_id: user.id });
    return result;
  };

  // ---------- Público ----------
  add('GET', '/api/config', (ctx) => {
    const s = settings();
    ctx.json(200, {
      provinces: PROVINCES,
      countries: COUNTRIES.map((c) => ({ name: c.name, code: c.code })),
      default_country: DEFAULT_COUNTRY,
      categories: store.list('categories', (c) => c.active !== false).map((c) => c.name),
      category_tree: categoryTree(),
      currencies: CURRENCIES,
      maxPeriodDays: MAX_PERIOD_DAYS,
      minObservations: MIN_OBSERVATIONS,
      minDistinctDays: MIN_DISTINCT_DAYS,
      periodChoices: PERIOD_CHOICES,
      announcement: s.announcement || '',
      default_days: s.default_days || 7,
      visual: normalizeVisual(s),
      plans: PLANS,
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

  add('GET', '/api/info', (ctx) => {
    ctx.json(200, { modules: MODULE_INFO, about: ABOUT });
  });

  add('GET', '/api/openapi.json', (ctx) => {
    ctx.json(200, buildOpenApi(routes));
  });

  // ---------- Autenticación ----------
  add('POST', '/api/auth/register', async (ctx) => {
    const body = await readJson(ctx.req);
    const username = String(body.username ?? '').trim().toLowerCase();
    if (!validateUsername(username)) {
      throw new HttpError(400, 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
    }
    if (!validatePassword(body.password)) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.');
    const email = String(body.email ?? '').trim().toLowerCase();
    if (email && !validateEmail(email)) throw new HttpError(400, 'El correo no es válido.');
    if (store.get('users', (u) => u.username === username)) throw new HttpError(409, 'Ese nombre de usuario ya está en uso.');
    if (email && store.get('users', (u) => u.email === email)) throw new HttpError(409, 'Ese correo ya está en uso.');
    // El registro público siempre crea usuarios normales. El superadministrador solo se crea por consola.
    const user = store.insert('users', {
      username,
      email,
      email_verified: false,
      password_hash: hashPassword(body.password),
      role: ROLES.USER,
      disabled: false,
    });
    if (email) await sendVerification(user);
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

  // Recuperación: la respuesta es siempre la misma para no revelar qué correos existen
  add('POST', '/api/auth/forgot', async (ctx) => {
    const body = await readJson(ctx.req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!validateEmail(email)) throw new HttpError(400, 'Escribe un correo válido.');
    const generic = { ok: true, message: 'Si el correo está registrado, recibirás un enlace en unos minutos.' };
    if (!resetMailReady()) {
      recordError('recuperacion', 'Se pidió recuperar una contraseña, pero el correo no está configurado (RESEND_API_KEY, RESOLVER_MAIL_FROM, RESOLVER_APP_URL).');
      return ctx.json(200, generic);
    }
    const user = store.get('users', (u) => u.email === email && !u.disabled);
    if (!user) return ctx.json(200, generic);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (store.list('resets', (r) => r.user_id === user.id && r.created_at > hourAgo).length >= 3) return ctx.json(200, generic);

    const token = newToken();
    store.insert('resets', {
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + RECOVERY_MINUTES * 60 * 1000).toISOString(),
      used: false,
    });
    const link = `${cfg.appUrl.replace(/\/+$/, '')}/?reset=${encodeURIComponent(token)}`;
    const result = await sendMail({
      apiKey: cfg.resendApiKey,
      from: cfg.mailFrom,
      to: email,
      subject: 'Recuperar contraseña de RESOLVER',
      fetchImpl: cfg.fetchImpl,
      text: `Hola ${user.username}.\n\nPara definir una contraseña nueva, abre este enlace antes de ${RECOVERY_MINUTES} minutos:\n${link}\n\nSi no lo pediste, ignora este mensaje.`,
    });
    if (!result.sent) recordError('recuperacion', result.reason, { user_id: user.id });
    ctx.json(200, generic);
  });

  add('POST', '/api/auth/reset', async (ctx) => {
    const body = await readJson(ctx.req);
    if (!validatePassword(body.password)) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.');
    const reset = store.get('resets', (r) => r.token_hash === hashToken(String(body.token ?? '')) && !r.used);
    const invalid = new HttpError(400, 'El enlace no es válido o ya caducó. Pide uno nuevo.');
    if (!reset || new Date(reset.expires_at) < new Date()) throw invalid;
    const user = store.get('users', (u) => u.id === reset.user_id);
    if (!user || user.disabled) throw invalid;
    store.update('users', user.id, { password_hash: hashPassword(body.password) });
    store.update('resets', reset.id, { used: true });
    for (const s of store.list('sessions', (x) => x.user_id === user.id)) store.remove('sessions', s.id);
    ctx.json(200, { ok: true, message: 'Contraseña actualizada. Inicia sesión de nuevo.' });
  });

  // Confirmación de correo con el enlace recibido
  add('POST', '/api/auth/verify', async (ctx) => {
    const body = await readJson(ctx.req);
    const v = store.get('verifications', (x) => x.token_hash === hashToken(String(body.token ?? '')) && !x.used);
    const invalid = new HttpError(400, 'El enlace no es válido o ya caducó. Pide uno nuevo desde tu perfil.');
    if (!v || new Date(v.expires_at) < new Date()) throw invalid;
    const user = store.get('users', (u) => u.id === v.user_id);
    // Si el correo cambió después del envío, el enlace ya no vale
    if (!user || user.disabled || user.email !== v.email) throw invalid;
    store.update('users', user.id, { email_verified: true });
    store.update('verifications', v.id, { used: true });
    ctx.json(200, { ok: true, message: 'Correo confirmado.' });
  });

  // ---------- Perfil, preferencias y sesiones ----------
  // Pide un nuevo enlace de confirmación. Máximo 3 por hora.
  add('POST', '/api/profile/verify/send', async (ctx) => {
    requireUser(ctx);
    const current = store.get('users', (u) => u.id === ctx.user.id);
    if (!current.email) throw new HttpError(400, 'Primero agrega un correo a tu perfil.');
    if (current.email_verified) throw new HttpError(400, 'Tu correo ya está confirmado.');
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (store.list('verifications', (v) => v.user_id === current.id && v.created_at > hourAgo).length >= 3) {
      throw new HttpError(429, 'Ya pediste varios enlaces. Espera una hora e inténtalo de nuevo.');
    }
    const result = await sendVerification(current);
    ctx.json(200, {
      ok: true,
      sent: result.sent,
      message: result.sent
        ? 'Te enviamos un enlace de confirmación.'
        : 'El envío de correos no está configurado en el servidor. El administrador puede confirmar tu correo desde el panel.',
    });
  });

  add('GET', '/api/profile', (ctx) => {
    requireUser(ctx);
    ctx.json(200, { user: publicUser(ctx.user) });
  });

  add('PATCH', '/api/profile', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const patch = {};
    if (body.display_name !== undefined) patch.display_name = String(body.display_name).trim().slice(0, 60);
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (email && !validateEmail(email)) throw new HttpError(400, 'El correo no es válido.');
      if (email && store.get('users', (u) => u.email === email && u.id !== ctx.user.id)) throw new HttpError(409, 'Ese correo ya está en uso.');
      patch.email = email;
      if (email !== (ctx.user.email || '')) patch.email_verified = false;
    }
    if (body.preferences !== undefined) {
      const p = body.preferences || {};
      const next = { ...DEFAULT_PREFS, ...(ctx.user.preferences || {}) };
      if (p.theme !== undefined) {
        if (!THEMES.includes(p.theme)) throw new HttpError(400, 'Tema no válido.');
        next.theme = p.theme;
      }
      if (p.default_days !== undefined) {
        if (!PERIOD_CHOICES.includes(Number(p.default_days))) throw new HttpError(400, 'Período no válido.');
        next.default_days = Number(p.default_days);
      }
      if (p.default_province !== undefined) {
        if (p.default_province && !PROVINCES.includes(p.default_province)) throw new HttpError(400, 'Provincia no válida.');
        next.default_province = p.default_province || '';
      }
      patch.preferences = next;
    }
    const updated = store.update('users', ctx.user.id, patch);
    ctx.json(200, { user: publicUser(updated) });
  });

  add('POST', '/api/profile/password', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    if (!verifyPassword(String(body.current ?? ''), ctx.user.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
    if (!validatePassword(body.password)) throw new HttpError(400, 'La contraseña nueva debe tener al menos 10 caracteres.');
    store.update('users', ctx.user.id, { password_hash: hashPassword(body.password) });
    // Se cierran las demás sesiones; la actual sigue abierta
    const current = sessionOf(ctx.req);
    for (const s of store.list('sessions', (x) => x.user_id === ctx.user.id && x.id !== current?.id)) store.remove('sessions', s.id);
    ctx.json(200, { ok: true });
  });

  add('GET', '/api/profile/sessions', (ctx) => {
    requireUser(ctx);
    const current = sessionOf(ctx.req);
    const now = new Date();
    const sessions = store
      .list('sessions', (s) => s.user_id === ctx.user.id && new Date(s.expires_at) > now)
      .map((s) => ({ id: s.id, created_at: s.created_at, expires_at: s.expires_at, current: current?.id === s.id }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    ctx.json(200, { sessions });
  });

  add('DELETE', '/api/profile/sessions/:id', (ctx) => {
    requireUser(ctx);
    const s = store.get('sessions', (x) => x.id === ctx.params.id);
    if (!s || s.user_id !== ctx.user.id) throw new HttpError(404, 'Sesión no encontrada.');
    store.remove('sessions', s.id);
    ctx.json(200, { ok: true });
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
    const country = q.get('country') || DEFAULT_COUNTRY;
    if (!COUNTRIES.some((c) => c.name === country)) throw new HttpError(400, 'País no válido.');
    const province = q.get('province') || '';
    const municipality = (q.get('municipality') || '').trim().slice(0, 80);
    const category = q.get('category') || '';
    const brand = (q.get('brand') || '').trim().slice(0, 60);
    const model = (q.get('model') || '').trim().slice(0, 60);
    const sort = q.get('sort') || 'fecha_desc';
    if (!SORTS.includes(sort)) throw new HttpError(400, 'Orden no válido.');
    const limit = Math.min(Math.max(Number.parseInt(q.get('limit'), 10) || 50, 1), MAX_RESULTS);
    const offset = Math.max(Number.parseInt(q.get('offset'), 10) || 0, 0);
    if (province && !PROVINCES.includes(province)) throw new HttpError(400, 'Provincia no válida.');
    if (category && !store.get('categories', (c) => c.name === category)) throw new HttpError(400, 'Categoría no válida.');
    let period;
    try {
      period = resolvePeriod({ end: q.get('end') || '', days: q.get('days') || 7 });
    } catch (err) {
      throw new HttpError(400, err.message);
    }

    const scope = {
      q: text,
      province,
      municipality,
      brand,
      model,
      categories: categoryScope(store, category),
    };
    // Solo cuentan publicaciones de grupos activos dentro del período pedido
    const matched = filterPosts(
      activePosts(country).filter((p) => inDay(p, period.start, period.end)),
      { ...scope, start: period.start, end: period.end },
    );
    const analysis = analyze(matched, period);
    analysis.municipalities = municipalityPrices(matched, primaryCurrency(matched));

    // Comparación con el mismo número de días inmediatamente anteriores
    const prevPeriod = resolvePeriod({ end: dayBefore(period.start), days: period.days });
    const previous = filterPosts(
      activePosts(country).filter((p) => inDay(p, prevPeriod.start, prevPeriod.end)),
      { ...scope, start: prevPeriod.start, end: prevPeriod.end },
    );
    const comparison = { period: prevPeriod, total: previous.length, ...compareWindows(matched, previous) };

    const page = sortPosts(matched, sort).slice(offset, offset + limit).map(publicPost);
    const nextOffset = offset + page.length < matched.length ? offset + page.length : null;

    // Solo la primera página entra al historial; "Cargar más" no duplica la búsqueda
    let searchId = null;
    if (offset === 0) {
      const recorded = store.insert('searches', {
        user_id: ctx.user.id,
        q: text,
        filters: { province, municipality, category, brand, model, sort },
        period,
        total: matched.length,
        summary: { sources: analysis.sources, prices: analysis.prices },
      });
      searchId = recorded.id;
    }

    ctx.json(200, {
      period,
      filters: { q: text, country, province, municipality, category, brand, model, sort },
      total: matched.length,
      search_id: searchId,
      offset,
      limit,
      next_offset: nextOffset,
      truncated: nextOffset !== null,
      results: page,
      analysis,
      comparison,
    });
  });

  add('GET', '/api/municipalities', (ctx) => {
    requireUser(ctx);
    const province = ctx.query.get('province') || '';
    if (!PROVINCES.includes(province)) throw new HttpError(400, 'Provincia no válida.');
    const names = new Set(
      activePosts()
        .filter((p) => p.province === province && p.municipality)
        .map((p) => p.municipality),
    );
    ctx.json(200, { municipalities: [...names].sort((a, b) => a.localeCompare(b, 'es')) });
  });

  // ---------- Exploración ----------
  add('GET', '/api/explore', (ctx) => {
    requireUser(ctx);
    const q = ctx.query;
    const kind = q.get('kind') || 'productos';
    if (!EXPLORE_KINDS.includes(kind)) throw new HttpError(400, 'Vista no válida.');
    const country = q.get('country') || DEFAULT_COUNTRY;
    if (!COUNTRIES.some((c) => c.name === country)) throw new HttpError(400, 'País no válido.');
    const province = q.get('province') || '';
    const category = q.get('category') || '';
    if (province && !PROVINCES.includes(province)) throw new HttpError(400, 'Provincia no válida.');
    if (kind === 'municipios' && !province) throw new HttpError(400, 'Elige una provincia para ver sus municipios.');
    let period;
    try {
      period = resolvePeriod({ end: q.get('end') || '', days: q.get('days') || MAX_PERIOD_DAYS });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const inPeriod = filterPosts(activePosts(country), {
      province,
      categories: categoryScope(store, category),
      start: period.start,
      end: period.end,
    });
    const currency = primaryCurrency(inPeriod);
    const base = { kind, period, total_posts: inPeriod.length, currency };

    if (kind === 'productos') return ctx.json(200, { ...base, items: exploreProducts(inPeriod) });
    if (kind === 'categorias') return ctx.json(200, { ...base, tops: exploreCategories(inPeriod) });
    if (kind === 'publicaciones') {
      return ctx.json(200, { ...base, items: sortPosts(inPeriod, 'fecha_desc').slice(0, 50).map(publicPost) });
    }
    if (kind === 'presencia') {
      return ctx.json(200, { ...base, items: exploreProducts(inPeriod).filter((i) => i.posts >= 2).sort((a, b) => b.posts - a.posts).slice(0, 30) });
    }
    if (kind === 'provincias') {
      const items = PROVINCES.map((name) => {
        const list = inPeriod.filter((p) => p.province === name);
        const s = currency ? statsOf(list.filter((p) => p.currency === currency).map((p) => p.price)) : null;
        return {
          province: name,
          posts: list.length,
          priced: s?.count ?? 0,
          median: s?.sufficient ? s.median : null,
          avg: s?.sufficient ? s.avg : null,
        };
      }).filter((i) => i.posts > 0).sort((a, b) => b.posts - a.posts);
      return ctx.json(200, { ...base, items });
    }
    if (kind === 'municipios') {
      const list = inPeriod.filter((p) => p.province === province);
      const counts = analyze(list, period).distribution.byMunicipality.filter((m) => m.key);
      return ctx.json(200, { ...base, items: municipalityPrices(list, currency), counts });
    }
    if (kind === 'movimientos') {
      // Compara siempre los últimos 7 días con los 7 anteriores
      const items = detectCandidates(activePosts(country)).filter((c) => MOVEMENT_TYPES.includes(c.type));
      return ctx.json(200, { ...base, items, window: 'últimos 7 días frente a los 7 anteriores' });
    }
    // oportunidades: señales guardadas y activas
    const items = store
      .list('signals', (s) => OPPORTUNITY_TYPES.includes(s.type) && s.status === 'activa')
      .sort((a, b) => (a.detected_at < b.detected_at ? 1 : -1))
      .slice(0, 50);
    return ctx.json(200, { ...base, items });
  });

  // ---------- Inicio ----------
  // Todo sale de publicaciones reales de grupos activos. Las búsquedas son solo del propio usuario.
  add('GET', '/api/dashboard', (ctx) => {
    requireUser(ctx);
    const groups = groupsById();
    const data = buildDashboard(activePosts());
    const recent = store
      .list('searches', (s) => s.user_id === ctx.user.id)
      .slice(-5)
      .reverse();
    const signals = store
      .list('signals', (s) => s.status === 'activa')
      .sort((a, b) => (a.detected_at < b.detected_at ? 1 : -1))
      .slice(0, 8);
    const activity = store
      .list('imports')
      .slice(-8)
      .reverse()
      .map((i) => ({
        group_name: groups.get(i.group_id)?.name ?? '—',
        day: i.day,
        received: i.received,
        inserted: i.inserted,
        duplicates: i.duplicates,
        created_at: i.created_at,
      }));
    ctx.json(200, { ...data, signals, recent_searches: recent, activity });
  });

  // ---------- Señales ----------
  add('GET', '/api/signals', (ctx) => {
    requireUser(ctx);
    const q = ctx.query;
    const type = q.get('type') || '';
    const province = q.get('province') || '';
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    const limit = Math.min(Math.max(Number.parseInt(q.get('limit'), 10) || 100, 1), 300);
    const signals = store
      .list('signals', (s) => {
        if (s.status !== 'activa') return false;
        if (type && s.type !== type) return false;
        if (province && s.province !== province) return false;
        const day = dayOf(s.detected_at);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .sort((a, b) => (a.detected_at < b.detected_at ? 1 : -1))
      .slice(0, limit);
    ctx.json(200, { signals, total: signals.length });
  });

  // ---------- Historial ----------
  add('GET', '/api/searches', (ctx) => {
    requireUser(ctx);
    const from = ctx.query.get('from') || '';
    const to = ctx.query.get('to') || '';
    const searches = store
      .list('searches', (s) => {
        if (s.user_id !== ctx.user.id) return false;
        const day = dayOf(s.created_at);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .slice(-100)
      .reverse();
    ctx.json(200, { searches });
  });

  add('GET', '/api/searches/compare', (ctx) => {
    requireUser(ctx);
    const a = store.get('searches', (s) => s.id === ctx.query.get('a'));
    const b = store.get('searches', (s) => s.id === ctx.query.get('b'));
    if (!a || !b || a.user_id !== ctx.user.id || b.user_id !== ctx.user.id) throw new HttpError(404, 'Búsqueda no encontrada.');
    const curs = [...new Set([...Object.keys(a.summary?.prices || {}), ...Object.keys(b.summary?.prices || {})])];
    const currencies = Object.fromEntries(
      curs.map((cur) => {
        const pa = a.summary?.prices?.[cur];
        const pb = b.summary?.prices?.[cur];
        const change = pa?.sufficient && pb?.sufficient && pb.median ? Math.round(((pa.median - pb.median) / pb.median) * 10000) / 100 : null;
        return [cur, { a: pa || null, b: pb || null, median_change_pct: change }];
      }),
    );
    const view = (s) => ({ id: s.id, q: s.q, filters: s.filters, period: s.period, total: s.total, created_at: s.created_at });
    ctx.json(200, { a: view(a), b: view(b), currencies });
  });

  add('DELETE', '/api/searches/:id', (ctx) => {
    requireUser(ctx);
    const s = store.get('searches', (x) => x.id === ctx.params.id);
    if (!s || s.user_id !== ctx.user.id) throw new HttpError(404, 'Búsqueda no encontrada.');
    store.remove('searches', s.id);
    ctx.json(200, { ok: true });
  });

  // Elementos guardados: búsquedas, análisis y señales. Se copian desde el registro original, no desde lo que envía el navegador.
  add('GET', '/api/saves', (ctx) => {
    requireUser(ctx);
    const kind = ctx.query.get('kind') || '';
    const from = ctx.query.get('from') || '';
    const to = ctx.query.get('to') || '';
    const saves = store
      .list('saves', (s) => {
        if (s.user_id !== ctx.user.id) return false;
        if (kind && s.kind !== kind) return false;
        const day = dayOf(s.created_at);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .slice()
      .reverse();
    ctx.json(200, { saves });
  });

  add('POST', '/api/saves', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    if (!SAVE_KINDS.includes(body.kind)) throw new HttpError(400, 'Tipo de elemento no válido.');
    let ref_id;
    let snapshot;
    let label;
    if (body.kind === 'signal') {
      const s = store.get('signals', (x) => x.id === body.ref_id);
      if (!s) throw new HttpError(404, 'Señal no encontrada.');
      ref_id = s.id;
      label = s.title;
      snapshot = { type: s.type, title: s.title, description: s.description, product: s.product, province: s.province, currency: s.currency, period: s.period, evidence: s.evidence, confidence: s.confidence, filters: s.filters, detected_at: s.detected_at };
    } else {
      const s = store.get('searches', (x) => x.id === body.ref_id && x.user_id === ctx.user.id);
      if (!s) throw new HttpError(404, 'Búsqueda no encontrada.');
      if (body.kind === 'analysis' && !s.summary) throw new HttpError(400, 'Esa búsqueda no tiene análisis guardado.');
      ref_id = s.id;
      label = s.q || '(sin texto)';
      snapshot = { q: s.q, filters: s.filters, period: s.period, total: s.total, ...(body.kind === 'analysis' ? { summary: s.summary } : {}) };
    }
    if (store.get('saves', (x) => x.user_id === ctx.user.id && x.kind === body.kind && x.ref_id === ref_id)) {
      throw new HttpError(409, 'Ya está guardado.');
    }
    const saved = store.insert('saves', { user_id: ctx.user.id, kind: body.kind, ref_id, label, snapshot });
    ctx.json(201, { save: saved });
  });

  add('DELETE', '/api/saves/:id', (ctx) => {
    requireUser(ctx);
    const s = store.get('saves', (x) => x.id === ctx.params.id);
    if (!s || s.user_id !== ctx.user.id) throw new HttpError(404, 'Elemento no encontrado.');
    store.remove('saves', s.id);
    ctx.json(200, { ok: true });
  });

  // ---------- Incidencias, sugerencias y reclamaciones (usuarios) ----------
  add('POST', '/api/reports', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    if (!REPORT_TYPES.includes(body.type)) throw new HttpError(400, 'Tipo no válido.');
    const message = String(body.message ?? '').trim();
    if (message.length < 10 || message.length > 1000) throw new HttpError(400, 'El mensaje debe tener de 10 a 1000 caracteres.');
    const report = store.insert('reports', { user_id: ctx.user.id, username: ctx.user.username, type: body.type, message, status: 'abierto' });
    ctx.json(201, { report });
  });

  // ---------- Administración: resumen y supervisión (superadministrador y moderador) ----------
  add('GET', '/api/admin/overview', (ctx) => {
    requireContent(ctx);
    ctx.json(200, {
      users: store.list('users').length,
      groups: store.list('groups').length,
      activeGroups: store.list('groups', (g) => g.status === 'activo').length,
      posts: store.list('posts').length,
      searches: store.list('searches').length,
      openReports: store.list('reports', (r) => r.status === 'abierto').length,
      activeSignals: store.list('signals', (s) => s.status === 'activa').length,
      role: ctx.user.role,
    });
  });

  add('GET', '/api/admin/stats', (ctx) => {
    requireSuper(ctx);
    const now = new Date();
    const byRole = {};
    for (const u of store.list('users')) byRole[u.role] = (byRole[u.role] || 0) + 1;
    ctx.json(200, {
      users: { total: store.list('users').length, by_role: byRole, disabled: store.list('users', (u) => u.disabled).length },
      sessions_active: store.list('sessions', (s) => new Date(s.expires_at) > now).length,
      groups: { total: store.list('groups').length, active: store.list('groups', (g) => g.status === 'activo').length, pending: store.list('groups', (g) => g.status === 'solicitado').length },
      posts: store.list('posts').length,
      imports: store.list('imports').length,
      searches: store.list('searches').length,
      saves: store.list('saves').length,
      signals: { active: store.list('signals', (s) => s.status === 'activa').length, retired: store.list('signals', (s) => s.status === 'retirada').length },
      reports: { open: store.list('reports', (r) => r.status === 'abierto').length, total: store.list('reports').length },
      errors: store.list('errors').length,
      storage: store instanceof SupabaseStore ? 'supabase' : 'archivo',
      storage_status: store.status(),
      uptime_seconds: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      recovery_mail: resetMailReady() ? 'configurado' : 'no configurado',
    });
  });

  add('GET', '/api/admin/errors', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, { errors: store.list('errors').slice(-200).reverse() });
  });

  add('GET', '/api/admin/settings', (ctx) => {
    requireSuper(ctx);
    ctx.json(200, { settings: settings() });
  });

  add('PATCH', '/api/admin/settings', async (ctx) => {
    requireSuper(ctx);
    const body = await readJson(ctx.req);
    const patch = {};
    if (body.announcement !== undefined) {
      const text = String(body.announcement).trim();
      if (text.length > 300) throw new HttpError(400, 'El aviso no puede superar 300 caracteres.');
      patch.announcement = text;
    }
    if (body.default_days !== undefined) {
      if (!PERIOD_CHOICES.includes(Number(body.default_days))) throw new HttpError(400, 'Período por defecto no válido.');
      patch.default_days = Number(body.default_days);
    }
    if (body.visual_style !== undefined) {
      if (!STYLE_IDS.includes(body.visual_style)) throw new HttpError(400, 'Estilo visual no válido.');
      patch.visual_style = body.visual_style;
    }
    if (body.visual_logo !== undefined) {
      if (!LOGO_IDS.includes(body.visual_logo)) throw new HttpError(400, 'Logo no válido.');
      patch.visual_logo = body.visual_logo;
    }
    const updated = store.update('settings', settings().id, patch);
    ctx.json(200, { settings: updated });
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
    // Restablecer contraseña: el administrador define una nueva y se cierran sus sesiones
    if (body.password !== undefined) {
      if (!validatePassword(body.password)) throw new HttpError(400, 'La contraseña nueva debe tener al menos 10 caracteres.');
      store.update('users', target.id, { password_hash: hashPassword(body.password) });
      for (const s of store.list('sessions', (x) => x.user_id === target.id)) store.remove('sessions', s.id);
      ctx.json(200, { user: publicUser(store.get('users', (u) => u.id === target.id)) });
      return;
    }
    if (body.role !== undefined) {
      if (![ROLES.USER, ROLES.MODERATOR].includes(body.role)) throw new HttpError(400, 'Rol no válido.');
      const updated = store.update('users', target.id, { role: body.role });
      ctx.json(200, { user: publicUser(updated) });
      return;
    }
    // Datos de perfil: correo, nombre y confirmación manual del correo (cuando no hay servicio de correo)
    if (body.email !== undefined || body.display_name !== undefined || body.email_verified !== undefined) {
      const patch = {};
      if (body.display_name !== undefined) patch.display_name = String(body.display_name).trim().slice(0, 60);
      if (body.email !== undefined) {
        const email = String(body.email).trim().toLowerCase();
        if (email && !validateEmail(email)) throw new HttpError(400, 'El correo no es válido.');
        if (email && store.get('users', (u) => u.email === email && u.id !== target.id)) throw new HttpError(409, 'Ese correo ya está en uso.');
        if (email !== (target.email || '')) patch.email_verified = false;
        patch.email = email;
      }
      if (body.email_verified !== undefined) {
        if (typeof body.email_verified !== 'boolean') throw new HttpError(400, 'email_verified debe ser verdadero o falso.');
        if (body.email_verified && !(patch.email ?? target.email)) throw new HttpError(400, 'Sin correo no se puede confirmar.');
        patch.email_verified = body.email_verified;
      }
      ctx.json(200, { user: publicUser(store.update('users', target.id, patch)) });
      return;
    }
    if (typeof body.disabled !== 'boolean') throw new HttpError(400, 'Indica el rol, si la cuenta está desactivada o una contraseña nueva.');
    const updated = store.update('users', target.id, { disabled: body.disabled });
    if (body.disabled) {
      for (const s of store.list('sessions', (x) => x.user_id === target.id)) store.remove('sessions', s.id);
    }
    ctx.json(200, { user: publicUser(updated) });
  });

  // ---------- Grupos ----------
  add('GET', '/api/admin/groups', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { groups: store.list('groups').map(groupView) });
  });

  // Alta de grupo por el administrador: después se carga su historial completo
  add('POST', '/api/admin/groups', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 120) throw new HttpError(400, 'El nombre del grupo debe tener de 3 a 120 caracteres.');
    const groupCountry = body.country || DEFAULT_COUNTRY;
    if (!COUNTRIES.some((c) => c.name === groupCountry)) throw new HttpError(400, 'País no válido.');
    if (!provincesOf(groupCountry).includes(body.province)) throw new HttpError(400, 'Selecciona la provincia del grupo.');
    const url = canonicalGroupUrl(body.url);
    if (store.get('groups', (g) => g.url.toLowerCase() === url.toLowerCase())) throw new HttpError(409, 'Ese grupo ya está registrado.');
    for (const key of ['created_on', 'history_from']) {
      if (body[key] && !isDay(body[key])) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD.');
    }
    const group = store.insert('groups', {
      name,
      url,
      country: groupCountry,
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
    requireContent(ctx);
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
  add('DELETE', '/api/admin/groups/:id', () => {
    throw new HttpError(403, 'Los grupos no se eliminan. Puedes pausarlos para que dejen de aparecer en las búsquedas.');
  });

  // ---------- Cargas y publicaciones ----------
  add('GET', '/api/admin/imports', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { imports: store.list('imports').slice().reverse() });
  });

  // Descarga del historial completo de un grupo en CSV (compatible con Excel: BOM UTF-8)
  add('GET', '/api/admin/groups/:id/export', (ctx) => {
    requireContent(ctx);
    const group = store.get('groups', (g) => g.id === ctx.params.id);
    if (!group) throw new HttpError(404, 'Grupo no encontrado.');
    const cols = ['published_at', 'product', 'price', 'currency', 'province', 'municipality', 'category', 'description', 'source_url', 'image_url', 'brand', 'model', 'seller', 'seller_contact'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = store
      .list('posts', (p) => p.group_id === group.id)
      .sort((a, b) => (a.published_at < b.published_at ? -1 : a.published_at > b.published_at ? 1 : 0));
    const csv = [cols.join(','), ...rows.map((p) => cols.map((c) => esc(p[c])).join(','))].join('\r\n');
    const fileName = group.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="resolver-${fileName}.csv"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(`﻿${csv}`);
  });

  add('GET', '/api/admin/groups/:id/history', (ctx) => {
    requireContent(ctx);
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
    requireContent(ctx);
    const groupId = ctx.query.get('group_id') || '';
    const groups = groupsById();
    const posts = store
      .list('posts', (p) => !groupId || p.group_id === groupId)
      .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
      .slice(0, 300)
      .map((p) => ({
        ...publicPost({ ...p, group_name: groups.get(p.group_id)?.name, group_url: groups.get(p.group_id)?.url }),
        group_id: p.group_id,
        hidden: p.hidden === true,
        hidden_reason: p.hidden_reason || '',
        hidden_at: p.hidden_at || null,
      }));
    ctx.json(200, { posts });
  });

  add('POST', '/api/admin/posts', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const group = store.get('groups', (g) => g.id === body.group_id);
    if (!group) throw new HttpError(400, 'Selecciona un grupo válido.');
    const { post, error } = validatePost(body, 0);
    if (error) throw new HttpError(400, error.message);
    const classified = classifyPost(post, categoryNames());
    const { fresh } = dedupe(store.list('posts'), [{ ...classified, group_id: group.id }]);
    if (!fresh.length) throw new HttpError(409, 'Esa publicación ya existe en la base de datos.');
    const saved = store.insert('posts', { ...classified, group_id: group.id, added_by: ctx.user.id });
    ctx.json(201, { post: saved });
  });

  add('POST', '/api/admin/imports', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req, 5 * 1024 * 1024);
    const group = store.get('groups', (g) => g.id === body.group_id);
    if (!group) throw new HttpError(400, 'Selecciona un grupo válido.');
    let rows;
    try {
      rows = body.format === 'lines'
        ? parseLines(body.content)
        : parseImport(body.format === 'json' ? 'application/json' : 'text/csv', body.content);
    } catch (err) {
      throw new HttpError(400, `No se pudo leer el contenido: ${err.message}`);
    }
    const { posts, errors } = validateBatch(rows);
    const known = categoryNames();
    const withGroup = posts.map((p) => ({ ...classifyPost(p, known), group_id: group.id }));
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
      format: ['json', 'lines'].includes(body.format) ? body.format : 'csv',
      day: todayISO(),
      received: rows.length,
      valid: posts.length,
      inserted: fresh.length,
      duplicates: skipped.length,
      error_count: errors.length,
      range_from: dates[0] || null,
      range_to: dates[dates.length - 1] || null,
    });
    // Tras cada carga se revisan las señales con los datos nuevos
    const signals = fresh.length ? syncSignals(store, activePosts(), new Date()) : { candidates: 0, created: 0 };
    ctx.json(200, {
      received: rows.length,
      valid: posts.length,
      inserted: fresh.length,
      duplicates: skipped.length,
      error_count: errors.length,
      errors: errors.slice(0, 100),
      signals,
    });
  });

  // Ocultar o mostrar una publicación. El motivo queda registrado; la publicación nunca se borra.
  add('PATCH', '/api/admin/posts/:id', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const post = store.get('posts', (p) => p.id === ctx.params.id);
    if (!post) throw new HttpError(404, 'Publicación no encontrada.');
    if (typeof body.hidden !== 'boolean') throw new HttpError(400, 'Indica si la publicación queda oculta (hidden: true o false).');
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (body.hidden && reason.length < 5) throw new HttpError(400, 'Escribe el motivo de la ocultación (mínimo 5 caracteres).');
    const now = new Date().toISOString();
    const updated = store.update(
      'posts',
      post.id,
      body.hidden
        ? { hidden: true, hidden_reason: reason, hidden_at: now, hidden_by: ctx.user.username }
        : { hidden: false, unhidden_at: now, unhidden_by: ctx.user.username },
    );
    ctx.json(200, {
      post: { id: updated.id, hidden: updated.hidden === true, hidden_reason: updated.hidden_reason || '', hidden_at: updated.hidden_at || null },
    });
  });

  // Las publicaciones cargadas son parte del historial permanente y no se borran
  add('DELETE', '/api/admin/posts/:id', () => {
    throw new HttpError(403, 'Las publicaciones no se eliminan: forman parte del historial permanente.');
  });

  // Foto de una publicación. Se valida por bytes (JPEG, PNG o WebP, máximo 2 MB) y se guarda en Supabase Storage.
  add('POST', '/api/admin/posts/:id/image', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req, Math.ceil(MAX_IMAGE_BYTES * 1.4));
    const post = store.get('posts', (p) => p.id === ctx.params.id);
    if (!post) throw new HttpError(404, 'Publicación no encontrada.');
    const raw = String(body.content_base64 ?? '').replace(/^data:[^,]*,/, '');
    if (!raw) throw new HttpError(400, 'Envía la imagen en content_base64.');
    const bytes = Buffer.from(raw, 'base64');
    if (!bytes.length) throw new HttpError(400, 'La imagen está vacía.');
    if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'La imagen supera 2 MB.');
    const kind = detectImage(bytes);
    if (!kind) throw new HttpError(400, 'Solo se aceptan imágenes JPEG, PNG o WebP.');
    const path = objectPath(post.id, kind.ext, randomUUID().slice(0, 8));
    const result = await uploadImage({
      baseUrl: cfg.supabaseUrl,
      key: cfg.supabaseKey,
      bucket: cfg.imageBucket,
      path,
      bytes,
      contentType: kind.type,
      fetchImpl: cfg.fetchImpl,
    });
    if (!result.sent) throw new HttpError(503, result.reason);
    const updated = store.update('posts', post.id, { image_url: result.url });
    ctx.json(200, { post: publicPost({ ...updated, group_name: groupsById().get(updated.group_id)?.name, group_url: groupsById().get(updated.group_id)?.url }) });
  });

  // Copia completa del almacén para el superadministrador. Sin contraseñas, sesiones ni tokens de recuperación.
  add('GET', '/api/admin/backup', (ctx) => {
    requireSuper(ctx);
    const OMIT = { sessions: null, resets: null, users: ['password_hash'] };
    const data = {};
    for (const c of COLLECTIONS) {
      if (c in OMIT && OMIT[c] === null) continue;
      const fields = OMIT[c] || [];
      data[c] = store.list(c).map((row) => {
        const copy = { ...row };
        for (const f of fields) delete copy[f];
        return copy;
      });
    }
    const body = {
      format: 'resolver-backup',
      version: 1,
      generated_at: new Date().toISOString(),
      omitted: { users: ['password_hash'], sessions: 'todas', resets: 'todos' },
      counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      data,
    };
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="resolver-respaldo-${todayISO()}.json"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(JSON.stringify(body));
  });

  // ---------- Categorías ----------
  add('GET', '/api/admin/categories', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { categories: store.list('categories'), tree: categoryTree(true) });
  });

  add('POST', '/api/admin/categories', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'La categoría debe tener de 2 a 60 caracteres.');
    if (store.get('categories', (c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, 'Esa categoría ya existe.');
    }
    const parent = body.parent ? String(body.parent) : null;
    if (parent && !store.get('categories', (c) => c.name === parent && c.parent === null)) {
      throw new HttpError(400, 'La categoría padre debe ser una categoría principal existente.');
    }
    ctx.json(201, { category: store.insert('categories', { name, parent, active: true }) });
  });

  add('PATCH', '/api/admin/categories/:id', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'Indica si la categoría está activa.');
    const updated = store.update('categories', ctx.params.id, { active: body.active });
    if (!updated) throw new HttpError(404, 'Categoría no encontrada.');
    ctx.json(200, { category: updated });
  });

  add('DELETE', '/api/admin/categories/:id', () => {
    throw new HttpError(403, 'Las categorías no se eliminan: puedes desactivarlas.');
  });

  // ---------- Reportes ----------
  add('GET', '/api/admin/reports', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { reports: store.list('reports').slice().reverse() });
  });

  add('PATCH', '/api/admin/reports/:id', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    if (!REPORT_STATUSES.includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    const updated = store.update('reports', ctx.params.id, { status: body.status });
    if (!updated) throw new HttpError(404, 'Reporte no encontrado.');
    ctx.json(200, { report: updated });
  });

  // ---------- Señales (gestión) ----------
  add('GET', '/api/admin/signals', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { signals: store.list('signals').slice().reverse().slice(0, 300) });
  });

  add('PATCH', '/api/admin/signals/:id', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    if (!SIGNAL_STATUSES.includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    const updated = store.update('signals', ctx.params.id, { status: body.status });
    if (!updated) throw new HttpError(404, 'Señal no encontrada.');
    ctx.json(200, { signal: updated });
  });

  add('POST', '/api/admin/signals/sync', (ctx) => {
    requireContent(ctx);
    ctx.json(200, syncSignals(store, activePosts(), new Date()));
  });

  // ---------- Fuentes ----------
  add('GET', '/api/admin/sources', (ctx) => {
    requireContent(ctx);
    ctx.json(200, { sources: store.list('sources') });
  });

  add('POST', '/api/admin/sources', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const key = String(body.key ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    if (!/^[a-z0-9-]{3,40}$/.test(key)) throw new HttpError(400, 'La clave debe tener de 3 a 40 caracteres: letras minúsculas, números y guion.');
    if (name.length < 3 || name.length > 120) throw new HttpError(400, 'El nombre debe tener de 3 a 120 caracteres.');
    if (store.get('sources', (s) => s.key === key)) throw new HttpError(409, 'Esa fuente ya existe.');
    const note = String(body.note ?? '').trim().slice(0, 500);
    ctx.json(201, { source: store.insert('sources', { key, name, kind: 'pendiente', status: 'no conectada', note }) });
  });

  add('PATCH', '/api/admin/sources/:id', async (ctx) => {
    requireContent(ctx);
    const body = await readJson(ctx.req);
    const source = store.get('sources', (s) => s.id === ctx.params.id);
    if (!source) throw new HttpError(404, 'Fuente no encontrada.');
    const patch = {};
    if (body.status !== undefined) {
      if (!['activa', 'no conectada', 'pausada'].includes(body.status)) throw new HttpError(400, 'Estado no válido.');
      // Ninguna fuente aparece como conectada si no tiene un adaptador real. La carga manual es la única activa por diseño.
      if (body.status === 'activa' && source.kind !== 'manual') {
        throw new HttpError(400, 'Esta fuente no tiene un adaptador conectado; no puede marcarse como activa.');
      }
      patch.status = body.status;
    }
    if (body.note !== undefined) patch.note = String(body.note).trim().slice(0, 500);
    const updated = store.update('sources', source.id, patch);
    if (!updated) throw new HttpError(404, 'Fuente no encontrada.');
    ctx.json(200, { source: updated });
  });

  // ---------- Supervisión de análisis ----------
  add('GET', '/api/admin/searches', (ctx) => {
    requireContent(ctx);
    const names = new Map(store.list('users').map((u) => [u.id, u.username]));
    const searches = store
      .list('searches')
      .slice(-200)
      .reverse()
      .map((s) => ({ id: s.id, username: names.get(s.user_id) || '—', q: s.q, filters: s.filters, period: s.period, total: s.total, created_at: s.created_at }));
    ctx.json(200, { searches });
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
      try {
        recordError('servidor', err.message, { path: pathname });
      } catch {
        /* el registro de errores no debe tumbar la respuesta */
      }
      if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor.' });
    }
  };
}

export async function createStore(cfg) {
  // Configuración a medias: no caer en silencio al archivo local (en Render se borra al reiniciar)
  if (Boolean(cfg.supabaseUrl) !== Boolean(cfg.supabaseKey)) {
    throw new Error('Define SUPABASE_URL y SUPABASE_SERVICE_KEY juntas, o ninguna.');
  }
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
