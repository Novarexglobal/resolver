// Deduplicación en tres niveles:
// 1. Mismo origen: misma fuente y mismo identificador de publicación. Es la misma publicación.
// 2. Cruzada: otra fuente con la misma huella (producto, precio, moneda, lugar, día y descripción). Se conserva un solo registro y se anota en qué fuentes apareció.
// 3. Nueva: se guarda.
import { fingerprint } from './core/hash.js';

/** Identidad estable de una publicación dentro de su fuente. */
export function identityOf(record) {
  return fingerprint([record.source_key, record.source_id]);
}

/** Índices de los registros existentes; se actualizan a medida que se planifica un lote. */
export function buildIndex(records) {
  const byId = new Map();
  const byFingerprint = new Map();
  for (const r of records) {
    byId.set(r.id, r);
    if (r.fingerprint) byFingerprint.set(r.fingerprint, r);
  }
  return { byId, byFingerprint };
}

/**
 * Clasifica un lote de candidatos sin escribir nada.
 * candidates: [{ record, rawId }]. Devuelve fresh (nuevos), sameSource y crossSource (duplicados).
 */
export function planBatch(candidates, index) {
  const plan = { fresh: [], sameSource: [], crossSource: [] };
  for (const c of candidates) {
    const id = identityOf(c.record);
    const same = index.byId.get(id);
    if (same) {
      plan.sameSource.push({ existing: same, rawId: c.rawId });
      continue;
    }
    const twin = index.byFingerprint.get(c.record.fingerprint);
    if (twin) {
      plan.crossSource.push({ existing: twin, rawId: c.rawId, source_key: c.record.source_key });
      continue;
    }
    // Se registra en el índice para detectar repetidos dentro del mismo lote
    const placeholder = { id, fingerprint: c.record.fingerprint };
    index.byId.set(id, placeholder);
    index.byFingerprint.set(c.record.fingerprint, placeholder);
    plan.fresh.push({ id, record: c.record, rawId: c.rawId });
  }
  return plan;
}
