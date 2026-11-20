#!/usr/bin/env node
// Copia de seguridad automática (plan gratuito): descarga el respaldo completo de RESOLVER con una cuenta de
// superadministrador y lo guarda en el bucket PRIVADO «respaldos» de Supabase Storage.
// Cada copia tiene nombre con fecha y hora y no sobrescribe ninguna anterior (x-upsert: false).
// Credenciales solo por variables de entorno: RESOLVER_URL, RESOLVER_RESPALDO_USER, RESOLVER_RESPALDO_PASSWORD,
// SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: RESPALDO_BUCKET (por defecto «respaldos»).
import { fileURLToPath } from 'node:url';

const BUCKET_DEFAULT = 'respaldos';

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Nombre único por fecha y hora (UTC), sin caracteres problemáticos. */
export function backupName(now = new Date()) {
  return `resolver-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

export async function runBackup({
  baseUrl,
  username,
  password,
  supabaseUrl,
  supabaseKey,
  bucket = BUCKET_DEFAULT,
  now = new Date(),
  fetchImpl = globalThis.fetch,
} = {}) {
  for (const [name, value] of Object.entries({ baseUrl, username, password, supabaseUrl, supabaseKey })) {
    if (!value) throw new BackupError(`Falta la configuración: ${name}.`);
  }
  const root = baseUrl.replace(/\/+$/, '');

  const login = await fetchImpl(`${root}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!login.ok || !cookie) throw new BackupError(`RESOLVER rechazó la cuenta de respaldo (${login.status}).`);

  const res = await fetchImpl(`${root}/api/admin/backup`, { headers: { Cookie: cookie, Accept: 'application/json' } });
  if (!res.ok) throw new BackupError(`RESOLVER no entregó el respaldo (${res.status}).`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BackupError('El respaldo de RESOLVER no es JSON válido.');
  }
  if (body.format !== 'resolver-backup' || !body.data || typeof body.data !== 'object') {
    throw new BackupError('El archivo recibido no tiene el formato de respaldo de RESOLVER.');
  }

  const name = backupName(now);
  const up = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'x-upsert': 'false',
    },
    body: text,
  });
  if (!up.ok) throw new BackupError(`Supabase Storage no guardó la copia (${up.status}). Revise que el bucket «${bucket}» exista y sea privado.`);

  return { file: `${bucket}/${name}`, bytes: Buffer.byteLength(text), counts: body.counts || {} };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  runBackup({
    baseUrl: env.RESOLVER_URL,
    username: env.RESOLVER_RESPALDO_USER,
    password: env.RESOLVER_RESPALDO_PASSWORD,
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_SERVICE_KEY,
    bucket: env.RESPALDO_BUCKET || BUCKET_DEFAULT,
  }).then(
    (result) => console.log(JSON.stringify({ ok: true, ...result })),
    (err) => {
      console.error(`Respaldo no realizado: ${err.message}`);
      process.exitCode = 1;
    },
  );
}
