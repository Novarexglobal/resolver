import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../../engine/index.js';
import { EngineStore } from '../../engine/store.js';
import { createManualInbox } from '../../engine/adapters/manual-inbox.js';
import { createRevolico } from '../../engine/adapters/revolico.js';
import { createMemorySink } from '../../engine/sinks/memory.js';
import { synchronize, toResolverRow } from '../../engine/synchronizer.js';
import { EngineError } from '../../engine/core/errors.js';
import { buildFromEnv, parseGroupMap } from '../../engine/app.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const now = () => NOW;
const noSleep = async () => {};
const CSV = [
  'producto,precio,moneda,provincia,fecha,descripcion,enlace,telefono',
  'Lavadora Mabe 7kg,45000,CUP,La Habana,2026-11-18,Vendo lavadora casi nueva,https://ejemplo.org/p/1,5555-1234',
  'Lavadora Mabe 7kg,45000,CUP,La Habana,2026-11-18,Vendo lavadora casi nueva,https://ejemplo.org/p/2,5555-1234',
  'Celular Redmi Note 12,$,,Matanzas,2026-11-19,Redmi Note 12 128gb,https://ejemplo.org/p/3,',
  'Laptop HP,350000,CUP,Pinar del Río,2026-11-17,Laptop HP i5 8gb ram,https://ejemplo.org/p/5,5555-9999',
].join('\n');

function setup({ sink = null, rows = CSV } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'motor-e2e-'));
  const inbox = join(dir, 'entrada');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'lote.csv'), rows);
  const store = new EngineStore({ file: join(dir, 'data', 'estado.json') });
  const engine = createEngine({
    adapters: [createManualInbox({ dir: inbox, processedDir: join(dir, 'procesados') }), createRevolico()],
    store,
    sink,
    now,
    sleep: noSleep,
  });
  return { dir, inbox, store, engine };
}

test('motor: una ejecución guarda, rechaza a cuarentena y anota las fuentes no conectadas', async () => {
  const t = setup();
  try {
    const out = await t.engine.runAll();
    const manual = out.results.find((r) => r.source === 'carpeta-manual');
    assert.equal(manual.status, 'parcial');
    assert.equal(manual.counts.fetched, 4);
    assert.equal(manual.counts.inserted, 2, 'la publicación repetida no se guarda dos veces');
    assert.equal(manual.counts.quarantined, 1, 'el precio «$» va a cuarentena');
    assert.equal(out.results.find((r) => r.source === 'revolico').status, 'omitida');
    const q = t.store.list('quarantine')[0];
    assert.ok(q.reasons.some((m) => /precio|moneda/i.test(m)));
    assert.equal(t.store.list('raw').filter((r) => r.status === 'cuarentena').length, 1, 'la fila original queda registrada');
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('motor: repetir la ejecución no duplica nada y no reenvía lo ya sincronizado', async () => {
  const sink = createMemorySink();
  const t = setup({ sink });
  try {
    const first = await t.engine.runAll();
    assert.equal(first.sync.synced, 2);
    assert.equal(sink.received.length, 2);
    const second = await t.engine.runAll();
    assert.equal(second.results.find((r) => r.source === 'carpeta-manual').counts.fetched, 0);
    assert.equal(second.sync.pending, 0);
    assert.equal(sink.received.length, 2);
    assert.equal(t.store.list('records').length, 2);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('motor: un destino que rechaza una publicación la reintenta en la siguiente ejecución', async () => {
  const sink = createMemorySink({ rejectProducts: ['Laptop HP'] });
  const t = setup({ sink });
  try {
    await t.engine.runAll();
    const failed = t.store.list('records').find((r) => r.product === 'Laptop HP');
    assert.equal(failed.sync_state, 'fallida');
    assert.equal(failed.sync_attempts, 1);
    assert.match(failed.sync_error, /regla de prueba/);
    const again = await t.engine.runAll();
    assert.equal(again.sync.pending, 1);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('motor: sin destino no simula sincronización', async () => {
  const t = setup();
  try {
    const out = await t.engine.runAll();
    assert.equal(out.sync.skipped, true);
    assert.equal(out.sync.synced, 0);
    assert.ok(t.store.list('records').every((r) => r.sync_state === 'pendiente'));
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('motor: ejecutar una fuente no conectada informa el motivo, no inventa datos', async () => {
  const t = setup();
  try {
    const out = await t.engine.runSource('revolico');
    assert.equal(out.results[0].status, 'no disponible');
    assert.match(out.results[0].message, /no está conectada/);
    assert.equal(t.store.list('records').length, 0);
    await assert.rejects(t.engine.runSource('no-existe'), EngineError);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('motor: un adaptador nuevo se añade sin cambiar el motor', async () => {
  const store = new EngineStore();
  const extra = {
    key: 'proveedor-nuevo',
    name: 'Proveedor nuevo',
    kind: 'api',
    country: 'Cuba',
    describe: () => ({ key: 'proveedor-nuevo', name: 'Proveedor nuevo', kind: 'api', status: 'activa', requirements: [], note: '' }),
    async fetch() {
      return { rows: [{ producto: 'Mesa', precio: 1200, provincia: 'Mayabeque', fecha: '2026-11-19', enlace: 'https://p.example/1' }], nextCursor: null, warnings: [] };
    },
  };
  const engine = createEngine({ adapters: [extra], store, now, sleep: noSleep });
  const out = await engine.runAll();
  assert.equal(out.results[0].counts.inserted, 1);
  assert.equal(store.list('records')[0].source_key, 'proveedor-nuevo');
});

test('motor: la fila de origen se conserva completa', async () => {
  const t = setup();
  try {
    await t.engine.runAll();
    const raw = t.store.list('raw')[0];
    assert.equal(raw.payload.producto, 'Lavadora Mabe 7kg');
    assert.equal(raw.source_file, 'lote.csv');
    assert.ok(raw.fetched_at);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('sincronizador: convierte al formato de RESOLVER y no pierde campos', () => {
  const row = toResolverRow({ product: 'Mesa', price: 10, currency: 'CUP', province: 'Matanzas', municipality: '', category: 'Hogar', published_at: '2026-11-18', description: '', source_url: '', image_url: '', brand: '', model: '', seller: '', seller_contact: '', internal_only: 'no' });
  assert.equal(row.product, 'Mesa');
  assert.equal(row.internal_only, undefined, 'los campos internos no salen del motor');
});

test('sincronizador: un error del destino deja los registros pendientes sin marcarlos', async () => {
  const store = new EngineStore();
  store.insert('records', { id: 'r1', product: 'Mesa', price: 1, currency: 'CUP', province: 'Matanzas', published_at: '2026-11-18', source_key: 'x', sync_state: 'pendiente', sync_attempts: 0 });
  const sink = { push: async () => { throw new EngineError('RESOLVER no responde', 'sink'); } };
  const out = await synchronize({ store, sink, now: NOW });
  assert.equal(out.error, 'RESOLVER no responde');
  assert.equal(store.list('records')[0].sync_state, 'pendiente');
});

test('montaje desde entorno: la configuración incompleta falla con mensaje claro', () => {
  assert.throws(() => parseGroupMap('no json'), EngineError);
  assert.throws(() => parseGroupMap('[1,2]'), EngineError);
  assert.deepEqual(parseGroupMap('{"manual":"g1"}'), { manual: 'g1' });
  const dir = mkdtempSync(join(tmpdir(), 'motor-env-'));
  try {
    const env = { ENGINE_STATE_FILE: join(dir, 's.json'), ENGINE_INBOX_DIR: join(dir, 'in'), ENGINE_PROCESSED_DIR: join(dir, 'ok') };
    const built = buildFromEnv(env);
    assert.equal(built.sinkConfigured, false);
    assert.deepEqual(built.engine.sources().map((s) => s.status), ['activa', 'no conectada', 'no conectada']);
    assert.throws(() => buildFromEnv({ ...env, RESOLVER_URL: 'https://r.example' }), EngineError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
