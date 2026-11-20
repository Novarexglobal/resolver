// Montaje del motor desde variables de entorno. Es la única parte que conoce rutas y credenciales;
// el resto del motor recibe adaptadores y destino ya construidos.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { EngineStore } from './store.js';
import { createEngine } from './index.js';
import { createManualInbox } from './adapters/manual-inbox.js';
import { createHttpFeed } from './adapters/http-feed.js';
import { createRevolico } from './adapters/revolico.js';
import { createResolverHttpSink } from './sinks/resolver-http.js';
import { EngineError } from './core/errors.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Rutas de trabajo. Todas se pueden cambiar con variables de entorno. */
export function defaultPaths(env = process.env) {
  return {
    state: env.ENGINE_STATE_FILE || join(HERE, 'data', 'estado.json'),
    inbox: env.ENGINE_INBOX_DIR || join(HERE, 'inbox'),
    processed: env.ENGINE_PROCESSED_DIR || join(HERE, 'processed'),
  };
}

/** ENGINE_GROUP_MAP = {"clave-de-fuente":"id-del-grupo-en-RESOLVER"}. Cada fuente se entrega a un único grupo. */
export function parseGroupMap(text) {
  if (!text) return {};
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    throw new EngineError('ENGINE_GROUP_MAP no es JSON válido.', 'config');
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new EngineError('ENGINE_GROUP_MAP debe ser un objeto {fuente: grupo}.', 'config');
  }
  return map;
}

/**
 * Construye el motor con las fuentes y el destino que indique el entorno.
 * - Carga manual: siempre activa (carpeta de entrada).
 * - Feed autorizado: activo solo con FEED_URL y FEED_TOKEN.
 * - Revolico: no conectada (documentada, sin intentos de conexión).
 * - Destino RESOLVER: solo con RESOLVER_URL; exige usuario y contraseña de moderador del motor.
 */
export function buildFromEnv(env = process.env, { fetchImpl = globalThis.fetch, now, sleep } = {}) {
  const paths = defaultPaths(env);
  const groupMap = parseGroupMap(env.ENGINE_GROUP_MAP);
  const store = new EngineStore({ file: paths.state });
  const adapters = [
    createManualInbox({ dir: paths.inbox, processedDir: paths.processed }),
    createHttpFeed({
      key: env.FEED_KEY || 'feed-autorizado',
      url: env.FEED_URL || '',
      token: env.FEED_TOKEN || '',
      format: env.FEED_FORMAT === 'csv' ? 'csv' : 'json',
      rowsPath: env.FEED_ROWS_PATH || '',
      fetchImpl,
    }),
    createRevolico(),
  ];
  const sink = env.RESOLVER_URL
    ? createResolverHttpSink({
      baseUrl: env.RESOLVER_URL,
      username: env.RESOLVER_ENGINE_USER,
      password: env.RESOLVER_ENGINE_PASSWORD,
      groupForSource: (key) => groupMap[key] || null,
      fetchImpl,
    })
    : null;
  const engine = createEngine({ adapters, store, sink, now, sleep });
  return { engine, store, paths, sinkConfigured: Boolean(sink) };
}
