// Almacén propio del motor: estado de fuentes, cargas crudas, registros, cuarentena, señales y errores.
// Independiente de la base de RESOLVER. Archivo JSON con escritura atómica; para producción se cambia por una base con la misma interfaz.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const COLLECTIONS = ['raw', 'runs', 'cursors', 'records', 'quarantine', 'errors', 'stats', 'signals'];

export class EngineStore {
  constructor({ file = null } = {}) {
    this.file = file;
    this.depth = 0;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) this.data[c] = Array.isArray(saved[c]) ? saved[c] : [];
    }
  }

  list(collection, predicate = () => true) {
    return this.data[collection].filter(predicate);
  }

  get(collection, predicate) {
    return this.data[collection].find(predicate) ?? null;
  }

  insert(collection, row) {
    const record = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
    this.data[collection].push(record);
    this.save();
    return record;
  }

  /** Inserta o actualiza por id, combinando campos. */
  put(collection, row) {
    const i = this.data[collection].findIndex((r) => r.id === row.id);
    if (i === -1) this.data[collection].push({ created_at: new Date().toISOString(), ...row });
    else this.data[collection][i] = { ...this.data[collection][i], ...row };
    this.save();
    return this.data[collection].find((r) => r.id === row.id);
  }

  update(collection, id, patch) {
    return this.put(collection, { id, ...patch });
  }

  getCursor(sourceKey) {
    return this.get('cursors', (c) => c.source_key === sourceKey)?.cursor ?? null;
  }

  setCursor(sourceKey, cursor) {
    const existing = this.get('cursors', (c) => c.source_key === sourceKey);
    return this.put('cursors', { id: existing?.id ?? `cursor:${sourceKey}`, source_key: sourceKey, cursor, updated_at: new Date().toISOString() });
  }

  /** Agrupa varias escrituras en una sola al final. */
  transaction(fn) {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      if (this.depth === 0) this.save();
    }
  }

  save() {
    if (!this.file || this.depth > 0) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
