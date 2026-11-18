import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SupabaseStore } from '../src/supabase-store.js';

// Simulación mínima de PostgREST: tabla en memoria con las operaciones que usa el adaptador
function fakeSupabase({ failNextWrites = 0 } = {}) {
  const rows = new Map();
  let failures = failNextWrites;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.apikey !== 'service-key') return res.writeHead(401).end();
      if (req.method !== 'GET' && failures > 0) {
        failures -= 1;
        return res.writeHead(503).end();
      }
      if (req.method === 'GET') {
        const list = [...rows.values()];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
      }
      if (req.method === 'POST') {
        const row = JSON.parse(body);
        rows.set(row.id, row);
        return res.writeHead(201).end();
      }
      if (req.method === 'DELETE') {
        rows.delete(url.searchParams.get('id').replace('eq.', ''));
        return res.writeHead(204).end();
      }
      res.writeHead(405).end();
    });
  });
  return { server, rows, setFailures: (n) => (failures = n) };
}

const waitFor = async (fn, ms = 3000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function stop(server) {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('escrituras llegan a Supabase y se recuperan al reiniciar', async () => {
  const fake = fakeSupabase();
  const url = await listen(fake.server);
  const store = new SupabaseStore({ url, key: 'service-key', retryMs: 20 });
  await store.load();
  const g = store.insert('groups', { name: 'Ventas La Habana', url: 'https://www.facebook.com/groups/x' });
  store.insertMany('posts', [{ product: 'iPhone 16', price: 950, group_id: g.id }, { product: 'iPhone 16 Pro', price: 1100, group_id: g.id }]);
  store.update('groups', g.id, { status: 'activo' });
  await waitFor(() => store.status().pending_writes === 0);
  assert.equal(fake.rows.size, 3);

  // Nuevo proceso: carga lo que quedó guardado
  const again = new SupabaseStore({ url, key: 'service-key' });
  await again.load();
  assert.equal(again.list('posts').length, 2);
  assert.equal(again.get('groups', (x) => x.id === g.id).status, 'activo');

  // Un borrado también llega a Supabase
  const victim = store.list('posts')[0];
  store.remove('posts', victim.id);
  await waitFor(() => store.status().pending_writes === 0);
  assert.equal(fake.rows.size, 2);
  await stop(fake.server);
});

test('si Supabase falla, las escrituras se reintentan en orden', async () => {
  const fake = fakeSupabase({ failNextWrites: 2 });
  const url = await listen(fake.server);
  const store = new SupabaseStore({ url, key: 'service-key', retryMs: 20 });
  await store.load();
  store.insert('posts', { product: 'A', price: 1 });
  store.insert('posts', { product: 'B', price: 2 });
  await waitFor(() => store.status().last_error !== null);
  await waitFor(() => store.status().pending_writes === 0);
  assert.equal(store.status().last_error, null);
  assert.equal(fake.rows.size, 2);
  await stop(fake.server);
});

test('clave incorrecta: error claro al cargar', async () => {
  const fake = fakeSupabase();
  const url = await listen(fake.server);
  const store = new SupabaseStore({ url, key: 'clave-mala' });
  await assert.rejects(store.load(), /HTTP 401/);
  await stop(fake.server);
});

test('sin credenciales no arranca', () => {
  assert.throws(() => new SupabaseStore({ url: '', key: '' }), /Faltan SUPABASE_URL/);
});

test('configuración a medias: createStore se niega a usar el archivo local', async () => {
  const { createStore } = await import('../src/server.js');
  await assert.rejects(createStore({ supabaseUrl: 'https://x.supabase.co', supabaseKey: '', dataFile: '/tmp/x.json' }), /juntas, o ninguna/);
});
