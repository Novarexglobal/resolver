import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBackup, backupName, BackupError } from '../scripts/respaldo.js';

const cfg = {
  baseUrl: 'https://resolver.example/',
  username: 'respaldo',
  password: 'clave-larga-123',
  supabaseUrl: 'https://proyecto.supabase.co',
  supabaseKey: 'clave-servicio',
  now: new Date('2026-11-22T03:00:00.000Z'),
};
const backupBody = JSON.stringify({ format: 'resolver-backup', version: 1, counts: { posts: 3 }, data: { posts: [{ id: 1 }] } });

test('respaldo: entra, descarga y guarda en el bucket privado sin sobrescribir', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/api/auth/login')) return new Response('{}', { status: 200, headers: { 'set-cookie': 'resolver_session=tok; Path=/; HttpOnly' } });
    if (String(url).endsWith('/api/admin/backup')) return new Response(backupBody, { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const out = await runBackup({ ...cfg, fetchImpl });
  assert.equal(out.file, 'respaldos/resolver-2026-11-22T03-00-00-000Z.json');
  assert.equal(out.counts.posts, 3);
  const upload = calls.find((c) => c.url.includes('/storage/v1/object/'));
  assert.equal(upload.opts.headers['x-upsert'], 'false');
  assert.equal(upload.opts.headers.apikey, 'clave-servicio');
  assert.equal(upload.opts.body, backupBody);
  assert.equal(calls.find((c) => c.url.endsWith('/api/admin/backup')).opts.headers.Cookie, 'resolver_session=tok');
});

test('respaldo: una cuenta rechazada detiene la copia antes de descargar nada', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response('{}', { status: 401 });
  };
  await assert.rejects(runBackup({ ...cfg, fetchImpl }), BackupError);
  assert.deepEqual(calls, ['https://resolver.example/api/auth/login']);
});

test('respaldo: un archivo que no es de RESOLVER no se guarda', async () => {
  const fetchImpl = async (url) => (String(url).endsWith('/login')
    ? new Response('{}', { status: 200, headers: { 'set-cookie': 'resolver_session=x; Path=/' } })
    : new Response('{"hola":1}', { status: 200 }));
  await assert.rejects(runBackup({ ...cfg, fetchImpl }), /formato de respaldo/);
});

test('respaldo: si el bucket no existe o no acepta la copia, se informa', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/login')) return new Response('{}', { status: 200, headers: { 'set-cookie': 'resolver_session=x; Path=/' } });
    if (String(url).endsWith('/backup')) return new Response(backupBody, { status: 200 });
    return new Response('{}', { status: 400 });
  };
  await assert.rejects(runBackup({ ...cfg, fetchImpl }), /bucket «respaldos»/);
});

test('respaldo: falta configuración: se dice cuál', async () => {
  await assert.rejects(runBackup({ ...cfg, supabaseKey: '', fetchImpl: async () => new Response('{}') }), /supabaseKey/);
  assert.equal(backupName(cfg.now), 'resolver-2026-11-22T03-00-00-000Z.json');
});
