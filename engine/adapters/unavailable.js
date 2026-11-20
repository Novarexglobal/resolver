// Fuente que aún no está disponible. No intenta conectarse: documenta lo que hace falta y responde «no disponible».
// Cuando haya acuerdo o API oficial, se reemplaza por un adaptador real con la misma forma (ver adapters/base.js).
import { SourceUnavailable } from '../core/errors.js';

export function createUnavailableSource({ key, name, kind = 'pendiente', country = 'Cuba', reason, requirements = [], docs = '' }) {
  return {
    key,
    name,
    kind,
    country,
    describe() {
      return {
        key,
        name,
        kind,
        status: 'no conectada',
        requirements,
        note: [reason, docs].filter(Boolean).join(' '),
      };
    },
    async fetch() {
      throw new SourceUnavailable(`${name} no está conectada. ${reason}`);
    },
  };
}
