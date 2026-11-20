// COLLECTOR: obtiene filas de un adaptador y guarda cada una tal como llegó (fuente original), sin repetir las ya guardadas.
import { RetryableError } from './core/errors.js';
import { stableHash } from './core/hash.js';

/**
 * Recorre las páginas de un adaptador hasta que no quedan más.
 * - Reintenta errores temporales con espera creciente (máximo maxRetries seguidos).
 * - Guarda el cursor después de cada página: si se corta, se continúa desde ahí.
 * - Llama a adapter.ack(página) solo cuando lo recibido ya está guardado.
 */
export async function collect(adapter, { store, now = () => new Date(), batchSize = 500, sleep, maxRetries = 3 }) {
  const summary = { fetched: 0, stored: 0, repeated: 0, warnings: [] };
  let cursor = store.getCursor(adapter.key);
  const seen = new Set(store.list('raw', (r) => r.source_key === adapter.key).map((r) => r.hash));
  let retries = 0;

  for (;;) {
    let page;
    try {
      page = await adapter.fetch({ cursor, limit: batchSize, now: now() });
    } catch (err) {
      if (err instanceof RetryableError && retries < maxRetries) {
        retries++;
        await sleep(err.retryAfterMs || 1000 * 2 ** retries);
        continue;
      }
      throw err;
    }
    retries = 0;
    const rows = Array.isArray(page.rows) ? page.rows : [];
    summary.fetched += rows.length;
    summary.warnings.push(...(page.warnings || []));

    store.transaction(() => {
      for (const row of rows) {
        const hash = stableHash(row);
        if (seen.has(hash)) {
          summary.repeated++;
          continue;
        }
        seen.add(hash);
        store.insert('raw', {
          source_key: adapter.key,
          fetched_at: now().toISOString(),
          hash,
          payload: row,
          status: 'nueva',
          source_file: row.source_file || null,
        });
        summary.stored++;
      }
    });

    // Lo recibido se guarda en el almacén antes de confirmar la fuente (y de mover archivos).
    await store.flush();
    if (typeof adapter.ack === 'function') await adapter.ack(page);
    const next = page.nextCursor ?? null;
    store.setCursor(adapter.key, next);
    if (!next || next === cursor || rows.length === 0) break;
    cursor = next;
  }
  return summary;
}
