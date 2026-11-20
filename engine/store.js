// Almacén propio del motor: estado de fuentes, cargas crudas, registros, cuarentena, señales y errores.
// Dos modos con la misma interfaz:
//  - archivo JSON local (desarrollo y pruebas), escritura atómica;
//  - Supabase, tabla public.engine_state (producción en plan gratuito, con GitHub Actions como programador).
// En modo Supabase, save() solo marca cambios; flush() los envía. El motor llama a flush() antes de mover
// cualquier archivo de la carpeta de entrada, para que lo leído nunca se pierda si el proceso se corta.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EngineError } from './core/errors.js';

export const COLLECTIONS = ['raw', 'runs', 'cursors', 'records', 'quarantine', 'errors', 'stats', 'signals'];
export const REMOTE_ID = 'main';

const emptyData = () => Object.fromEntries(COLLECTIONS.map((c) => [c, []]));

function normalize(saved) {
  const data = emptyData();
  for (const c of COLLECTIONS) data[c] = Array.isArray(saved?.[c]) ? saved[c] : [];
  return data;
}

export class EngineStore {
  /**
   * @param {object} o
   * @param {string|null} o.file    ruta del archivo JSON (modo archivo)
   * @param {object|null} o.remote  { url, key, fetchImpl? } para Supabase (modo remoto)
   */
  constructor({ file = null, remote = null } = {}) {
    this.file = file;
    this.remote = remote ? { id: REMOTE_ID, fetchImpl: globalThis.fetch, ...remote } : null;
    this.depth = 0;
    this.dirty = false;
    this.data = emptyData();
    if (!this.remote && file && existsSync(file)) {
      this.data = normalize(JSON.parse(readFileSync(file, 'utf8')));
    }
  }

  /** Abre el almacén. En modo remoto carga el estado guardado; si la carga falla, se detiene (no empieza vacío). */
  static async open(options = {}) {
    const store = new EngineStore(options);
    if (store.remote) await store.loadRemote();
    return store;
  }

  get mode() {
    return this.remote ? 'supabase' : this.file ? 'archivo' : 'memoria';
  }

  remoteHeaders(extra = {}) {
    return { apikey: this.remote.key, Authorization: `Bearer ${this.remote.key}`, ...extra };
  }

  remoteUrl(query = '') {
    return `${this.remote.url.replace(/\/+$/, '')}/rest/v1/engine_state${query}`;
  }

  async loadRemote() {
    let res;
    try {
      res = await this.remote.fetchImpl(this.remoteUrl(`?id=eq.${encodeURIComponent(this.remote.id)}&select=data`), {
        headers: this.remoteHeaders({ Accept: 'application/json' }),
      });
    } catch (err) {
      throw new EngineError(`No se pudo leer el estado del motor en Supabase: ${err.message}`, 'persistence');
    }
    if (!res.ok) throw new EngineError(`Supabase respondió ${res.status} al leer el estado del motor.`, 'persistence');
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) this.data = normalize(rows[0].data);
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

  /** Modo archivo: escribe al instante. Modo remoto: marca cambios para flush(). */
  save() {
    if (this.remote) {
      this.dirty = true;
      return;
    }
    if (!this.file || this.depth > 0) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  /** Envía los cambios pendientes a Supabase. Si falla, los cambios siguen marcados para el siguiente intento. */
  async flush() {
    if (!this.remote || !this.dirty || this.depth > 0) return { flushed: false };
    const body = JSON.stringify([{ id: this.remote.id, data: this.data, updated_at: new Date().toISOString() }]);
    let res;
    try {
      res = await this.remote.fetchImpl(this.remoteUrl('?on_conflict=id'), {
        method: 'POST',
        headers: this.remoteHeaders({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body,
      });
    } catch (err) {
      throw new EngineError(`No se pudo guardar el estado del motor en Supabase: ${err.message}`, 'persistence');
    }
    if (!res.ok) throw new EngineError(`Supabase respondió ${res.status} al guardar el estado del motor.`, 'persistence');
    this.dirty = false;
    return { flushed: true };
  }
}
