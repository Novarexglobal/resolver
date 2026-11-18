import { randomUUID } from 'node:crypto';
import { COLLECTIONS } from './store.js';

const snapshot = (record) => JSON.parse(JSON.stringify(record));

/**
 * Almacén respaldado por Supabase (PostgREST), con la misma interfaz que Store.
 * - Al arrancar carga todos los registros en memoria.
 * - Cada escritura se aplica en memoria al instante y se envía a Supabase en
 *   orden. Si Supabase falla, las escrituras quedan en cola y se reintentan.
 * La tabla y su seguridad están en db/supabase-schema.sql.
 */
export class SupabaseStore {
  constructor({ url, key, table = 'resolver_records', fetchImpl = globalThis.fetch, retryMs = 5000 }) {
    if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.');
    this.endpoint = `${url.replace(/\/+$/, '')}/rest/v1/${table}`;
    this.key = key;
    this.fetch = fetchImpl;
    this.retryMs = retryMs;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    this.queue = [];
    this.flushing = false;
    this.lastError = null;
    this.timer = null;
  }

  headers(extra = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra };
  }

  async load() {
    const res = await this.fetch(`${this.endpoint}?select=collection,data&order=created_at.asc`, {
      headers: this.headers({ Range: '0-99999' }),
    });
    if (!res.ok) throw new Error(`No se pudo leer Supabase (HTTP ${res.status}). Revisa la URL, la clave y la tabla.`);
    const rows = await res.json();
    for (const row of rows) {
      if (this.data[row.collection]) this.data[row.collection].push(row.data);
    }
  }

  enqueue(job) {
    this.queue.push(job);
    this.flush();
  }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        await this.send(this.queue[0]);
        this.queue.shift();
        this.lastError = null;
      }
    } catch (err) {
      this.lastError = err.message;
      console.error(`Supabase: ${err.message} Reintentando…`);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.retryMs);
    } finally {
      this.flushing = false;
    }
  }

  async send(job) {
    let res;
    if (job.op === 'upsert') {
      res = await this.fetch(`${this.endpoint}?on_conflict=id`, {
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ id: job.record.id, collection: job.collection, data: job.record }),
      });
    } else {
      res = await this.fetch(`${this.endpoint}?id=eq.${encodeURIComponent(job.id)}`, {
        method: 'DELETE',
        headers: this.headers({ Prefer: 'return=minimal' }),
      });
    }
    if (!res.ok) throw new Error(`Supabase rechazó la escritura (HTTP ${res.status}).`);
  }

  status() {
    return { pending_writes: this.queue.length, last_error: this.lastError };
  }

  list(collection, predicate = () => true) {
    return this.data[collection].filter(predicate);
  }

  get(collection, predicate) {
    return this.data[collection].find(predicate) || null;
  }

  insert(collection, row) {
    const record = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
    this.data[collection].push(record);
    this.enqueue({ op: 'upsert', collection, record: snapshot(record) });
    return record;
  }

  insertMany(collection, rows) {
    return rows.map((row) => this.insert(collection, row));
  }

  update(collection, id, patch) {
    const record = this.data[collection].find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, patch, { updated_at: new Date().toISOString() });
    this.enqueue({ op: 'upsert', collection, record: snapshot(record) });
    return record;
  }

  remove(collection, id) {
    const i = this.data[collection].findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.data[collection].splice(i, 1);
    this.enqueue({ op: 'delete', id });
    return true;
  }
}
