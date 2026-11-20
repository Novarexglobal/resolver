// SYNCHRONIZER: envía los registros válidos al destino (RESOLVER u otro) en lotes, sin duplicar y con reintentos.
import { EngineError } from './core/errors.js';

/** Campos que RESOLVER acepta en una publicación. */
export function toResolverRow(r) {
  return {
    product: r.product,
    price: r.price,
    currency: r.currency,
    province: r.province,
    municipality: r.municipality,
    category: r.category,
    published_at: r.published_at,
    description: r.description,
    source_url: r.source_url,
    image_url: r.image_url,
    brand: r.brand,
    model: r.model,
    seller: r.seller,
    seller_contact: r.seller_contact,
  };
}

/**
 * Envía lo pendiente. sink.push(items) recibe [{ id, source_key, row }] y devuelve
 * { accepted: [id], rejected: [{ id, message }] }. Lo no confirmado queda como fallido y se reintenta.
 * Sin destino configurado no envía nada y lo informa.
 */
export async function synchronize({ store, sink, batchSize = 200, maxAttempts = 5, now = new Date() }) {
  const pending = store.list('records', (r) => r.sync_state !== 'sincronizada' && (r.sync_attempts || 0) < maxAttempts);
  const counts = { pending: pending.length, sent: 0, synced: 0, failed: 0, skipped: false, error: null };
  if (!sink) return { ...counts, skipped: true, reason: 'No hay destino de sincronización configurado.' };

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const items = batch.map((r) => ({ id: r.id, source_key: r.source_key, row: toResolverRow(r) }));
    let result;
    try {
      result = await sink.push(items);
    } catch (err) {
      if (err instanceof EngineError) {
        counts.error = err.message;
        break;
      }
      throw err;
    }
    const accepted = new Set(result.accepted || []);
    const rejected = new Map((result.rejected || []).map((x) => [x.id, x.message]));
    store.transaction(() => {
      for (const r of batch) {
        if (accepted.has(r.id)) {
          store.update('records', r.id, { sync_state: 'sincronizada', synced_at: now.toISOString(), sync_error: '' });
          counts.synced++;
        } else {
          store.update('records', r.id, {
            sync_state: 'fallida',
            sync_attempts: (r.sync_attempts || 0) + 1,
            sync_error: rejected.get(r.id) || 'El destino no confirmó la publicación.',
          });
          counts.failed++;
        }
      }
    });
    counts.sent += batch.length;
  }
  return counts;
}
