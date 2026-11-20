import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpFeed } from '../../engine/adapters/http-feed.js';
import { createRevolico } from '../../engine/adapters/revolico.js';
import { createManualInbox } from '../../engine/adapters/manual-inbox.js';
import { validateAdapter } from '../../engine/adapters/base.js';
import { collect } from '../../engine/collector.js';
import { EngineStore } from '../../engine/store.js';
import { SourceUnavailable, RetryableError, EngineError } from '../../engine/core/errors.js';
import { createResolverHttpSink } from '../../engine/sinks/resolver-http.js';
import { startScheduler } from '../../engine/scheduler.js';

const json = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const noSleep = async () => {};

test('contrato: un adaptador sin clave válida o sin fetch se rechaza', () => {
  assert.throws(() => validateAdapter({ key: 'A', name: 'x', kind: 'feed', fetch() {}, describe() {} }), EngineError);
  assert.throws(() => validateAdapter({ key: 'buena-clave', name: 'x', kind: 'feed', describe() {} }), EngineError);
  assert.throws(() => validateAdapter({ key: 'buena-clave', name: 'x', kind: 'raro', fetch() {}, describe() {} }), EngineError);
  assert.equal(validateAdapter(createRevolico()).key, 'revolico');
});

test('feed sin credenciales: no está conectado y no hace ninguna petición', async () => {
  let calls = 0;
  const feed = createHttpFeed({ url: '', token: '', fetchImpl: async () => { calls++; return json(200, []); } });
  assert.equal(feed.describe().status, 'no conectada');
  await assert.rejects(feed.fetch({ cursor: null }), SourceUnavailable);
  assert.equal(calls, 0);
});

test('feed: pagina con cursor hasta el final y envía el token en la cabecera', async () => {
  const seen = [];
  const pages = { null: { data: [{ product: 'A' }], next_cursor: 'p2' }, p2: { data: [{ product: 'B' }], next_cursor: null } };
  const feed = createHttpFeed({
    url: 'https://proveedor.example/api',
    token: 'secreto',
    rowsPath: 'data',
    fetchImpl: async (url, opts) => {
      seen.push({ url: String(url), auth: opts.headers.Authorization });
      const cursor = new URL(url).searchParams.get('cursor') ?? 'null';
      return json(200, pages[cursor]);
    },
  });
  const store = new EngineStore();
  const got = await collect(feed, { store, sleep: noSleep });
  assert.equal(got.stored, 2);
  assert.equal(seen[0].auth, 'Bearer secreto');
  assert.match(seen[1].url, /cursor=p2/);
  assert.equal(store.getCursor('feed-autorizado'), null);
});

test('feed: 401 y 403 son «no disponible» y no se reintentan', async () => {
  let calls = 0;
  const feed = createHttpFeed({ url: 'https://x.example', token: 't', fetchImpl: async () => { calls++; return json(401, {}); } });
  await assert.rejects(collect(feed, { store: new EngineStore(), sleep: noSleep }), SourceUnavailable);
  assert.equal(calls, 1);
});

test('feed: 429 se reintenta respetando Retry-After; 5xx agota los reintentos', async () => {
  const waits = [];
  let n = 0;
  const feed = createHttpFeed({
    url: 'https://x.example',
    token: 't',
    rowsPath: '',
    fetchImpl: async () => {
      n++;
      if (n === 1) return json(429, {}, { 'retry-after': '3' });
      return json(200, [{ product: 'Mesa' }]);
    },
  });
  const got = await collect(feed, { store: new EngineStore(), sleep: async (ms) => waits.push(ms) });
  assert.equal(got.stored, 1);
  assert.deepEqual(waits, [3000]);

  const failing = createHttpFeed({ url: 'https://x.example', token: 't', fetchImpl: async () => json(503, {}) });
  await assert.rejects(collect(failing, { store: new EngineStore(), sleep: noSleep, maxRetries: 2 }), RetryableError);
});

test('feed: respuesta sin lista se reporta como error de formato', async () => {
  const feed = createHttpFeed({ url: 'https://x.example', token: 't', rowsPath: 'data', fetchImpl: async () => json(200, { otro: 1 }) });
  await assert.rejects(feed.fetch({ cursor: null }), (e) => e instanceof EngineError && e.code === 'format');
});

test('revolico: no conectada, documentada, y nunca hace peticiones', async () => {
  const rev = createRevolico();
  const d = rev.describe();
  assert.equal(d.status, 'no conectada');
  assert.ok(d.requirements.length >= 2);
  await assert.rejects(rev.fetch({}), (e) => e instanceof SourceUnavailable && /no está conectada/.test(e.message));
});

test('carga manual: lee CSV y JSON, mueve lo leído a procesados y nunca borra', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'motor-in-'));
  const processed = join(dir, 'procesados');
  const inbox = join(dir, 'entrada');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'a.csv'), 'producto,precio\nMesa,100\n');
  writeFileSync(join(inbox, 'b.json'), JSON.stringify([{ producto: 'Silla', precio: 50 }]));
  writeFileSync(join(inbox, 'roto.json'), '{ no es json');
  writeFileSync(join(inbox, 'notas.txt'), 'ignorar');
  try {
    const inboxAdapter = createManualInbox({ dir: inbox, processedDir: processed });
    const store = new EngineStore();
    const got = await collect(inboxAdapter, { store, sleep: noSleep });
    assert.equal(got.stored, 2);
    assert.equal(got.warnings.length, 1, 'el archivo roto queda con advertencia');
    assert.ok(got.warnings[0].message.includes('roto.json'));
    assert.deepEqual(readdirSync(inbox).sort(), ['notas.txt', 'roto.json'], 'lo leído sale de la entrada; lo roto y lo ajeno se quedan');
    assert.equal(readdirSync(processed).length, 2, 'lo leído queda en procesados');
    const again = await collect(inboxAdapter, { store, sleep: noSleep });
    assert.equal(again.stored, 0, 'una segunda pasada no vuelve a guardar lo mismo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reintentos: el cursor se guarda por página y se reanuda', async () => {
  const store = new EngineStore();
  store.setCursor('fuente-prueba', 'p9');
  let asked = null;
  const adapter = {
    key: 'fuente-prueba',
    name: 'Prueba',
    kind: 'api',
    async fetch({ cursor }) {
      asked = cursor;
      return { rows: [{ product: 'Mesa', seq: 1 }], nextCursor: null, warnings: [] };
    },
  };
  await collect(adapter, { store, sleep: noSleep });
  assert.equal(asked, 'p9', 'continúa desde el último cursor guardado');
});

test('RESOLVER: entra como moderador, importa por grupo y separa aceptados de rechazados', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/api/auth/login')) {
      return json(200, { ok: true }, { 'set-cookie': 'resolver_session=abc123; Path=/; HttpOnly' });
    }
    return json(200, { error_count: 1, errors: [{ row: 2, message: 'Precio inválido' }] });
  };
  const sink = createResolverHttpSink({
    baseUrl: 'https://resolver.example/',
    username: 'motor',
    password: 'clave',
    groupForSource: (k) => (k === 'manual' ? 'grupo-1' : null),
    fetchImpl,
  });
  const items = [
    { id: 'r1', source_key: 'manual', row: { product: 'Mesa' } },
    { id: 'r2', source_key: 'manual', row: { product: 'Silla' } },
    { id: 'r3', source_key: 'sin-grupo', row: { product: 'Lámpara' } },
  ];
  const result = await sink.push(items);
  assert.deepEqual(result.accepted, ['r1']);
  assert.deepEqual(result.rejected.map((x) => x.id).sort(), ['r2', 'r3']);
  assert.equal(result.rejected.find((x) => x.id === 'r2').message, 'Precio inválido');
  const importCall = calls.find((c) => c.url.endsWith('/api/admin/imports'));
  assert.equal(importCall.url, 'https://resolver.example/api/admin/imports');
  assert.equal(importCall.opts.headers.Cookie, 'resolver_session=abc123');
  const body = JSON.parse(importCall.opts.body);
  assert.equal(body.group_id, 'grupo-1');
  assert.equal(body.format, 'json');
  assert.equal(JSON.parse(body.content).length, 2);
  assert.ok(!importCall.opts.body.includes('clave'), 'la contraseña no viaja en la importación');
});

test('RESOLVER: errores sin detalle no se confirman (se reintentan)', async () => {
  const sink = createResolverHttpSink({
    baseUrl: 'https://resolver.example',
    username: 'motor',
    password: 'clave',
    groupForSource: () => 'g',
    fetchImpl: async (url) => (String(url).endsWith('/login')
      ? json(200, {}, { 'set-cookie': 'resolver_session=s; Path=/' })
      : json(200, { error_count: 3, errors: [] })),
  });
  const result = await sink.push([{ id: 'x', source_key: 'manual', row: {} }, { id: 'y', source_key: 'manual', row: {} }]);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].message, /se reintenta/);
});

test('RESOLVER: sesión vencida (401) vuelve a entrar una vez', async () => {
  let logins = 0;
  let imports = 0;
  const sink = createResolverHttpSink({
    baseUrl: 'https://resolver.example',
    username: 'motor',
    password: 'clave',
    groupForSource: () => 'g',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/login')) {
        logins++;
        return json(200, {}, { 'set-cookie': `resolver_session=s${logins}; Path=/` });
      }
      imports++;
      return imports === 1 ? json(401, {}) : json(200, { error_count: 0, errors: [] });
    },
  });
  const result = await sink.push([{ id: 'x', source_key: 'manual', row: {} }]);
  assert.equal(logins, 2);
  assert.deepEqual(result.accepted, ['x']);
});

test('RESOLVER: sin credenciales el destino no arranca', () => {
  assert.throws(() => createResolverHttpSink({ baseUrl: 'https://r.example', username: '', password: '' }), EngineError);
});

test('programador: intervalo mínimo y ejecución sin solaparse', async () => {
  assert.throws(() => startScheduler({ runAll: async () => ({}) }, { everyMinutes: 1 }));
  let scheduled = null;
  const fakeSet = (fn, ms) => { scheduled = { fn, ms }; return { unref() {} }; };
  let runs = 0;
  const engine = { runAll: async () => { runs++; return { ok: true }; } };
  const s = startScheduler(engine, { everyMinutes: 5, runOnStart: true, setIntervalImpl: fakeSet, clearIntervalImpl: () => {} });
  assert.equal(scheduled.ms, 5 * 60 * 1000);
  await scheduled.fn();
  assert.equal(runs, 2);
  s.stop();
});
