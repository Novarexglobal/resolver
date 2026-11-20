// Destino en memoria: para pruebas y para ver qué se enviaría sin tocar RESOLVER.
import { EngineError } from '../core/errors.js';

export function createMemorySink({ rejectProducts = [], failWith = null } = {}) {
  const received = [];
  return {
    received,
    async push(items) {
      if (failWith) throw new EngineError(failWith, 'sink');
      const accepted = [];
      const rejected = [];
      for (const item of items) {
        if (rejectProducts.includes(item.row.product)) {
          rejected.push({ id: item.id, message: 'Rechazada por la regla de prueba.' });
        } else {
          accepted.push(item.id);
          received.push(item);
        }
      }
      return { accepted, rejected };
    },
  };
}
