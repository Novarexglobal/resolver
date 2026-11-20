// Huellas y hashes estables para detectar duplicados y cambios en las fuentes originales.
import { createHash } from 'node:crypto';

export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');

/** Huella de un conjunto de partes. El orden importa; los nulos cuentan como vacío. */
export function fingerprint(parts) {
  return sha256(parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|'));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

/** Hash de un objeto sin depender del orden de sus claves. */
export function stableHash(value) {
  return sha256(JSON.stringify(sortKeys(value)));
}
