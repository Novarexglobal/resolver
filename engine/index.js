// Orquestador del motor. Une COLLECTOR → PROCESSOR → CLASSIFIER → cuarentena → deduplicación
// → ANALYZER → DETECTOR → SYNCHRONIZER. Cada fuente se ejecuta sola; si una falla, las demás siguen.
import { validateAdapter } from './adapters/base.js';
import { collect } from './collector.js';
import { processRow } from './processor.js';
import { buildIndex, planBatch } from './dedupe.js';
import { analyze } from './analyzer.js';
import { detect, DEFAULTS } from './detector.js';
import { synchronize } from './synchronizer.js';
import { EngineError, SourceUnavailable } from './core/errors.js';
import { addDays, dayIn, TIMEZONE } from './core/dates.js';

/**
 * @param {object} o
 * @param {Array} o.adapters     adaptadores con la forma de adapters/base.js
 * @param {EngineStore} o.store  almacén del motor
 * @param {object|null} o.sink   destino (sinks/); null = no sincroniza
 */
export function createEngine({
  adapters = [],
  store,
  sink = null,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  batchSize = 500,
  syncBatchSize = 200,
  maxRetries = 3,
  minObservations = DEFAULTS.minObservations,
  historyDays = 90,
} = {}) {
  if (!store) throw new EngineError('Falta el almacén del motor.', 'config');
  const registry = new Map();
  for (const adapter of adapters) {
    validateAdapter(adapter);
    if (registry.has(adapter.key)) throw new EngineError(`Fuente duplicada: ${adapter.key}`, 'config');
    registry.set(adapter.key, adapter);
  }
  let busy = false;

  const finish = (run, status, message, counts) => {
    store.update('runs', run.id, { status, message, counts, finished_at: now().toISOString() });
  };

  const logError = (sourceKey, runId, kind, err) => {
    store.insert('errors', {
      source_key: sourceKey,
      run_id: runId,
      kind,
      code: err.code || 'error',
      message: String(err.message || err).slice(0, 500),
      at: now().toISOString(),
    });
  };

  // Suma una fuente nueva a un registro ya guardado (misma publicación o misma huella en otra fuente)
  const attach = (recordId, rawId, sourceKey) => {
    const rec = store.get('records', (r) => r.id === recordId);
    if (!rec) return;
    store.update('records', recordId, {
      raw_ids: [...(rec.raw_ids || []), rawId],
      sources_seen: [...new Set([...(rec.sources_seen || []), sourceKey])],
    });
  };

  // Procesa las cargas crudas pendientes de una fuente, por lotes
  function processPending(adapter, runId, counts) {
    const pending = store.list('raw', (r) => r.source_key === adapter.key && r.status === 'nueva');
    const source = { key: adapter.key, country: adapter.country || 'Cuba' };
    for (let i = 0; i < pending.length; i += batchSize) {
      const chunk = pending.slice(i, i + batchSize);
      store.transaction(() => {
        const candidates = [];
        for (const raw of chunk) {
          const result = processRow(raw.payload, { now: now(), source, defaultCurrency: adapter.defaultCurrency || 'CUP' });
          if (!result.ok) {
            store.insert('quarantine', {
              source_key: adapter.key,
              raw_id: raw.id,
              run_id: runId,
              reasons: result.issues.filter((x) => x.severity === 'error').map((x) => x.message),
              issues: result.issues,
              status: 'pendiente revisión',
            });
            store.update('raw', raw.id, { status: 'cuarentena' });
            counts.quarantined++;
            continue;
          }
          candidates.push({
            rawId: raw.id,
            record: { ...result.record, quality_score: result.quality, quality_issues: result.issues.map((x) => x.message) },
          });
        }
        const index = buildIndex(store.list('records'));
        const plan = planBatch(candidates, index);
        for (const f of plan.fresh) {
          store.insert('records', {
            ...f.record,
            id: f.id,
            first_seen_at: now().toISOString(),
            sources_seen: [adapter.key],
            raw_ids: [f.rawId],
            sync_state: 'pendiente',
            sync_attempts: 0,
          });
          store.update('raw', f.rawId, { status: 'procesada' });
          counts.inserted++;
        }
        for (const d of plan.sameSource) {
          attach(d.existing.id, d.rawId, adapter.key);
          store.update('raw', d.rawId, { status: 'duplicada' });
          counts.duplicates++;
        }
        for (const d of plan.crossSource) {
          attach(d.existing.id, d.rawId, adapter.key);
          store.update('raw', d.rawId, { status: 'duplicada' });
          counts.cross_duplicates++;
        }
      });
    }
  }

  // Estadística, señales y señales guardadas. Solo se guarda lo nuevo; nada se borra.
  function refreshAnalysis() {
    const since = addDays(dayIn(now(), TIMEZONE), -historyDays);
    const records = store.list('records', (r) => r.published_at >= since);
    const stats = analyze(records, { minObservations });
    store.transaction(() => {
      for (const s of stats) store.put('stats', s);
    });
    const signals = detect({ stats, records, now: now(), options: { minObservations } });
    let created = 0;
    store.transaction(() => {
      for (const s of signals) {
        if (store.get('signals', (x) => x.id === s.id)) continue;
        store.insert('signals', s);
        created++;
      }
    });
    return { stats: stats.length, signals_detected: signals.length, signals_created: created };
  }

  async function execute(keys, mode) {
    const results = [];
    for (const key of keys) {
      const adapter = registry.get(key);
      if (!adapter) {
        results.push({ source: key, status: 'desconocida' });
        continue;
      }
      const run = store.insert('runs', { source_key: key, status: 'en curso', started_at: now().toISOString(), counts: {} });
      const counts = { fetched: 0, stored: 0, repeated: 0, inserted: 0, duplicates: 0, cross_duplicates: 0, quarantined: 0, warnings: 0 };
      const described = adapter.describe();
      if (mode === 'todas' && described.status !== 'activa') {
        finish(run, 'omitida', 'La fuente no está conectada; no se intentó.', counts);
        results.push({ source: key, status: 'omitida' });
        continue;
      }
      try {
        const got = await collect(adapter, { store, now, batchSize, sleep, maxRetries });
        counts.fetched = got.fetched;
        counts.stored = got.stored;
        counts.repeated = got.repeated;
        for (const w of got.warnings) {
          counts.warnings++;
          store.insert('errors', { source_key: key, run_id: run.id, kind: 'fuente', code: 'advertencia', message: String(w.message || w).slice(0, 500), at: now().toISOString() });
        }
        processPending(adapter, run.id, counts);
        const status = counts.quarantined || counts.warnings ? 'parcial' : 'ok';
        finish(run, status, '', counts);
        results.push({ source: key, status, counts });
      } catch (err) {
        const status = err instanceof SourceUnavailable ? 'no disponible' : 'error';
        logError(key, run.id, status === 'error' ? 'ejecucion' : 'fuente', err);
        finish(run, status, err.message, counts);
        results.push({ source: key, status, message: err.message });
      }
      await store.flush();
    }
    const analysis = refreshAnalysis();
    const sync = await synchronize({ store, sink, batchSize: syncBatchSize, now: now() });
    await store.flush();
    return { results, analysis, sync };
  }

  async function guarded(fn) {
    if (busy) return { skipped: true, reason: 'Ya hay una ejecución en curso.' };
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  return {
    /** Ejecuta todas las fuentes conectadas. Las no conectadas se registran como omitidas. */
    runAll: () => guarded(() => execute([...registry.keys()], 'todas')),
    /** Ejecuta una fuente. Si no está conectada, la ejecución queda como «no disponible» con el motivo. */
    runSource: (key) => guarded(() => {
      if (!registry.has(key)) throw new EngineError(`Fuente desconocida: ${key}`, 'unknown_source');
      return execute([key], 'una');
    }),
    /** Estado para el panel o la línea de comandos. */
    status: () => ({
      sources: [...registry.values()].map((a) => a.describe()),
      runs: store.list('runs').slice(-20).reverse(),
      records: store.list('records').length,
      pending_sync: store.list('records', (r) => r.sync_state !== 'sincronizada').length,
      quarantine_open: store.list('quarantine', (q) => q.status === 'pendiente revisión').length,
      signals_active: store.list('signals', (s) => s.status === 'activa').length,
      errors_recent: store.list('errors').slice(-20).reverse(),
    }),
    sources: () => [...registry.values()].map((a) => a.describe()),
  };
}
