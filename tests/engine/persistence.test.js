import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineStore } from '../../engine/store.js';
import { createEngine } from '../../engine/index.js';
import { createManualInbox } from '../../engine/adapters/manual-inbox.js';
import { EngineError } from '../../engine/core/errors.js';
import { storeOptionsFromEnv } from '../../engine/app.js';
import { main } from '../../engine/cli.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CSV = 'producto,precio,moneda,provincia,fecha,descripcion,enlace\nMesa,100,CUP,Matanzas,2026-11-18,Mesa de madera,https://ejemplo.org/1\n';

/** Fake de Supabase REST: guarda la última fila y registra cada llamada en orden. */
function fakeSupabase({ initial = [], failGet = false, failPostAt = [] } = {}) {
  const events = [];
  let rows = initial;
  let posts = 0;
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET') {
      events.push('get');
      if (failGet) return json(500, {});
      return json(200, rows);
    }
    posts++;
    events.push('post');
    if (failPostAt.includes(posts)) return json(503, {});
    rows = JSON.parse(opts.body);
    return json(201, undefined);
  };
  return { fetchImpl, events, get saved() { return rows; }, get posts() { return posts; } };
}

test('persistencia: sin Supabase la carga queda en archivo; con Supabase, en remoto', async () => {
  const file = await EngineStore.open({ file: join(tmpdir(), 'no-existe-motor.json') });
  assert.equal(file.mode, 'archivo');
  const remote = fakeSupabase();
  const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'k', fetchImpl: remote.fetchImpl } });
  assert.equal(store.mode, 'supabase');
  assert.deepEqual(store.list('raw'), []);
});

test('persistencia: si no se puede leer el estado, el motor no arranca (no sobrescribe con vacío)', async () => {
  const remote = fakeSupabase({ failGet: true });
  await assert.rejects(
    EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'k', fetchImpl: remote.fetchImpl } }),
    (e) => e instanceof EngineError && e.code === 'persistence',
  );
  assert.equal(remote.posts, 0);
});

test('persistencia: el estado guardado se restaura al abrir', async () => {
  const saved = { raw: [{ id: 'r1', source_key: 'manual' }], records: [{ id: 'x', product: 'Mesa' }] };
  const remote = fakeSupabase({ initial: [{ data: saved }] });
  const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co/', key: 'k', fetchImpl: remote.fetchImpl } });
  assert.equal(store.list('raw').length, 1);
  assert.equal(store.get('records', (r) => r.id === 'x').product, 'Mesa');
  assert.deepEqual(store.list('quarantine'), [], 'las colecciones que faltan quedan vacías');
});

test('persistencia: flush envía una sola fila con la clave de servicio y solo si hay cambios', async () => {
  const remote = fakeSupabase();
  const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'clave-secreta', fetchImpl: remote.fetchImpl } });
  assert.equal((await store.flush()).flushed, false, 'sin cambios no envía nada');
  store.insert('runs', { source_key: 'manual', status: 'ok' });
  assert.equal(remote.posts, 0, 'guardar en memoria no envía por sí solo');
  assert.equal((await store.flush()).flushed, true);
  assert.equal(remote.saved[0].id, 'main');
  assert.equal(remote.saved[0].data.runs.length, 1);
});

test('persistencia: un flush fallido conserva los cambios para el siguiente intento', async () => {
  const remote = fakeSupabase({ failPostAt: [1] });
  const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'k', fetchImpl: remote.fetchImpl } });
  store.insert('runs', { source_key: 'manual', status: 'ok' });
  await assert.rejects(store.flush(), (e) => e instanceof EngineError && e.code === 'persistence');
  assert.equal((await store.flush()).flushed, true);
  assert.equal(remote.saved[0].data.runs.length, 1);
});

test('persistencia: lo leído se guarda antes de mover el archivo de la entrada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'motor-orden-'));
  const inbox = join(dir, 'entrada');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'lote.csv'), CSV);
  const remote = fakeSupabase();
  try {
    const adapter = createManualInbox({ dir: inbox, processedDir: join(dir, 'procesados') });
    const realAck = adapter.ack;
    const order = [];
    adapter.ack = async (page) => { order.push('ack'); return realAck(page); };
    const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'k', fetchImpl: async (u, o) => { if (o?.method === 'POST') order.push('post'); return remote.fetchImpl(u, o); } } });
    const engine = createEngine({ adapters: [adapter], store, now: () => NOW, sleep: async () => {} });
    await engine.runAll();
    assert.deepEqual(order.slice(0, 2), ['post', 'ack'], 'primero se guarda, después se mueve');
    assert.equal(readdirSync(inbox).length, 0);
    assert.equal(remote.saved[0].data.records.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistencia: si el guardado falla, el archivo se queda en la entrada (nada se pierde)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'motor-corte-'));
  const inbox = join(dir, 'entrada');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'lote.csv'), CSV);
  const remote = fakeSupabase({ failPostAt: [1] });
  try {
    const adapter = createManualInbox({ dir: inbox, processedDir: join(dir, 'procesados') });
    const store = await EngineStore.open({ remote: { url: 'https://x.supabase.co', key: 'k', fetchImpl: remote.fetchImpl } });
    const engine = createEngine({ adapters: [adapter], store, now: () => NOW, sleep: async () => {} });
    const out = await engine.runAll();
    assert.equal(out.results[0].status, 'error');
    assert.deepEqual(readdirSync(inbox), ['lote.csv'], 'el archivo sigue en la entrada para el siguiente intento');
    assert.equal(existsSync(join(dir, 'procesados')) ? readdirSync(join(dir, 'procesados')).length : 0, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configuración: Supabase exige URL y clave juntas', () => {
  assert.throws(() => storeOptionsFromEnv({ ENGINE_SUPABASE_URL: 'https://x.supabase.co' }), EngineError);
  assert.throws(() => storeOptionsFromEnv({ ENGINE_SUPABASE_KEY: 'k' }), EngineError);
  assert.equal(storeOptionsFromEnv({}).file.endsWith('estado.json'), true);
  assert.equal(storeOptionsFromEnv({ ENGINE_SUPABASE_URL: 'https://x', ENGINE_SUPABASE_KEY: 'k' }).remote.key, 'k');
});

test('cuarentena: se lista y se marca revisada sin borrar la fila', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'motor-cuar-'));
  const file = join(dir, 'estado.json');
  const seeded = { quarantine: [{ id: 'q1', source_key: 'manual', reasons: ['Falta el precio.'], status: 'pendiente revisión' }] };
  writeFileSync(file, JSON.stringify(seeded));
  const env = { ENGINE_STATE_FILE: file, ENGINE_INBOX_DIR: join(dir, 'in'), ENGINE_PROCESSED_DIR: join(dir, 'ok') };
  const logs = [];
  const original = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await main(['cuarentena'], env), 0);
    assert.match(logs.join('\n'), /Falta el precio/);
    assert.equal(await main(['cuarentena', 'revisar', 'q1', '--nota', 'precio confirmado con el grupo'], env), 0);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.quarantine.length, 1, 'no se borra');
    assert.equal(saved.quarantine[0].status, 'revisada');
    assert.equal(saved.quarantine[0].note, 'precio confirmado con el grupo');
    await assert.rejects(main(['cuarentena', 'revisar', 'no-existe'], env), /No hay ninguna fila/);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
