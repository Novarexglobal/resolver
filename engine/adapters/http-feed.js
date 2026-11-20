// Feed HTTP autorizado: API oficial, proveedor de datos o archivo que el proveedor publica para su cliente.
// Solo usa la URL y el token que el titular configura. No intenta saltarse ningún control de acceso:
// si la fuente rechaza las credenciales o pide otra autorización, el adaptador queda como «no disponible».
import { SourceUnavailable, RetryableError, EngineError } from '../core/errors.js';
import { parseCsv } from '../core/csv.js';

function pathGet(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

export function createHttpFeed({
  key = 'feed-autorizado',
  name = 'Feed autorizado (API o proveedor)',
  url = '',
  token = '',
  tokenHeader = 'Authorization',
  tokenPrefix = 'Bearer ',
  format = 'json',
  rowsPath = '',
  nextCursorPath = 'next_cursor',
  cursorParam = 'cursor',
  country = 'Cuba',
  defaultCurrency = 'CUP',
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
  requirements = [
    'URL del feed que entrega el proveedor o la API oficial.',
    'Token o credencial que la fuente emite para su uso autorizado (variable de entorno).',
    'Formato de respuesta: JSON (lista de publicaciones) o CSV con cabeceras.',
  ],
} = {}) {
  const missing = [];
  if (!url) missing.push('URL del feed');
  if (!token) missing.push('token de acceso');
  const configured = missing.length === 0;

  return {
    key,
    name,
    kind: 'feed',
    country,
    defaultCurrency,
    describe() {
      return {
        key,
        name,
        kind: 'feed',
        status: configured ? 'activa' : 'no conectada',
        requirements,
        note: configured ? 'Configurada.' : `Falta: ${missing.join(' y ')}.`,
      };
    },
    async fetch({ cursor }) {
      if (!configured) throw new SourceUnavailable(`${name} no está conectada. Falta: ${missing.join(' y ')}.`);
      const target = new URL(url);
      if (cursor) target.searchParams.set(cursorParam, cursor);
      let res;
      try {
        res = await fetchImpl(target, {
          headers: { [tokenHeader]: `${tokenPrefix}${token}`, Accept: format === 'csv' ? 'text/csv' : 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new RetryableError(`No se pudo contactar ${name}: ${err.message}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SourceUnavailable(`${name} rechazó las credenciales (${res.status}). Revise el token o la autorización con el proveedor.`);
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 60000;
        throw new RetryableError(`${name} limitó las peticiones.`, { retryAfterMs: wait });
      }
      if (res.status >= 500) throw new RetryableError(`${name} respondió ${res.status}.`);
      if (!res.ok) throw new EngineError(`${name} respondió ${res.status}.`, 'http');

      if (format === 'csv') {
        return { rows: parseCsv(await res.text()), nextCursor: null, warnings: [] };
      }
      const body = await res.json();
      const rows = pathGet(body, rowsPath);
      if (!Array.isArray(rows)) throw new EngineError(`${name}: la respuesta no contiene una lista en "${rowsPath || 'raíz'}".`, 'format');
      const next = pathGet(body, nextCursorPath);
      return { rows, nextCursor: next ? String(next) : null, warnings: [] };
    },
  };
}
