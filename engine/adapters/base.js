// Contrato de adaptador. Añadir una fuente es escribir un adaptador que cumpla esta forma; el motor no cambia.
//
// {
//   key:      'mi-fuente'            // 3-40 caracteres: minúsculas, números y guion
//   name:     'Nombre visible'
//   kind:     'manual' | 'feed' | 'api' | 'pendiente'
//   country:  'Cuba'                 // opcional; por defecto Cuba
//   defaultCurrency: 'CUP'           // opcional; moneda cuando la fuente no la indica
//   describe(): { key, name, kind, status: 'activa'|'no conectada', requirements: [], note }
//   fetch({ cursor, limit, now }) -> { rows: [objeto...], nextCursor: string|null, warnings: [{message}] }
//   ack?(page)                       // opcional: se llama cuando lo recibido ya está guardado
// }
//
// Errores que puede lanzar fetch:
//   SourceUnavailable  → no conectada, credenciales rechazadas. No se reintenta.
//   RetryableError     → fallo temporal. Se reintenta con espera.
//   EngineError        → cualquier otro fallo. Queda en el registro de errores.
import { EngineError } from '../core/errors.js';

export const KEY_PATTERN = /^[a-z0-9-]{3,40}$/;
export const KINDS = ['manual', 'feed', 'api', 'pendiente'];

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new EngineError('El adaptador debe ser un objeto.', 'config');
  if (!KEY_PATTERN.test(adapter.key || '')) {
    throw new EngineError(`Clave de fuente no válida: "${adapter.key}" (use 3-40 caracteres: minúsculas, números y guion).`, 'config');
  }
  if (!adapter.name) throw new EngineError(`La fuente ${adapter.key} necesita un nombre.`, 'config');
  if (!KINDS.includes(adapter.kind)) throw new EngineError(`Tipo de fuente no válido en ${adapter.key}.`, 'config');
  if (typeof adapter.fetch !== 'function') throw new EngineError(`La fuente ${adapter.key} no tiene fetch().`, 'config');
  if (typeof adapter.describe !== 'function') throw new EngineError(`La fuente ${adapter.key} no tiene describe().`, 'config');
  return adapter;
}
