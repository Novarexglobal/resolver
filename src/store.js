import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Colecciones persistidas. Todo empieza vacío: no hay datos de ejemplo.
// 'imports' es un registro de solo escritura: las cargas nunca se borran.
export const COLLECTIONS = ['users', 'sessions', 'groups', 'posts', 'searches', 'reports', 'categories', 'imports'];

/**
 * Almacén JSON con escritura atómica (tmp + rename).
 * Adecuado para un MVP de un solo proceso. La interfaz es sencilla para
 * migrar a Supabase/Postgres sin tocar las rutas ni la lógica de negocio.
 */
export class Store {
  constructor(file) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    for (const c of COLLECTIONS) this.data[c] ??= [];
  }

  status() {
    return { pending_writes: 0, last_error: null };
  }

  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  list(collection, predicate = () => true) {
    return this.data[collection].filter(predicate);
  }

  get(collection, predicate) {
    return this.data[collection].find(predicate) || null;
  }

  insert(collection, row) {
    const now = new Date().toISOString();
    const record = { id: randomUUID(), created_at: now, ...row };
    this.data[collection].push(record);
    this.save();
    return record;
  }

  // Inserta varias filas con una sola escritura a disco
  insertMany(collection, rows) {
    const now = new Date().toISOString();
    const records = rows.map((row) => ({ id: randomUUID(), created_at: now, ...row }));
    this.data[collection].push(...records);
    if (records.length) this.save();
    return records;
  }

  update(collection, id, patch) {
    const record = this.data[collection].find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, patch, { updated_at: new Date().toISOString() });
    this.save();
    return record;
  }

  remove(collection, id) {
    const i = this.data[collection].findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.data[collection].splice(i, 1);
    this.save();
    return true;
  }
}
