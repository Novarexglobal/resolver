// Destino RESOLVER por su API. Entra con una cuenta de moderador (mínimo privilegio) y usa la importación normal de RESOLVER.
// RESOLVER solo detalla los primeros 100 errores de una carga. Lo que no se pueda confirmar se marca como fallido y se reintenta: RESOLVER ignora los duplicados, así que el reintento es seguro.
import { EngineError } from '../core/errors.js';

export function createResolverHttpSink({ baseUrl, username, password, groupForSource, fetchImpl = globalThis.fetch, maxRows = 2000 }) {
  if (!baseUrl || !username || !password) throw new EngineError('Faltan la dirección, el usuario o la contraseña de RESOLVER.', 'config');
  const root = baseUrl.replace(/\/+$/, '');
  let cookie = null;

  async function login() {
    const res = await fetchImpl(`${root}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const set = res.headers.get('set-cookie');
    if (!res.ok || !set) throw new EngineError(`RESOLVER rechazó el acceso del motor (${res.status}).`, 'sink');
    cookie = set.split(';')[0];
  }

  async function importGroup(groupId, items) {
    const body = JSON.stringify({ group_id: groupId, format: 'json', content: JSON.stringify(items.map((i) => i.row)) });
    const send = () => fetchImpl(`${root}/api/admin/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body,
    });
    let res = await send();
    if (res.status === 401) {
      cookie = null;
      await login();
      res = await send();
    }
    if (!res.ok) throw new EngineError(`RESOLVER respondió ${res.status} a la importación.`, 'sink');
    return res.json();
  }

  return {
    async push(items) {
      if (!cookie) await login();
      const accepted = [];
      const rejected = [];
      const bySource = new Map();
      for (const item of items) {
        if (!bySource.has(item.source_key)) bySource.set(item.source_key, []);
        bySource.get(item.source_key).push(item);
      }
      for (const [sourceKey, list] of bySource) {
        const groupId = groupForSource(sourceKey);
        if (!groupId) {
          for (const i of list) rejected.push({ id: i.id, message: `Sin grupo de RESOLVER asignado a la fuente ${sourceKey}.` });
          continue;
        }
        for (let i = 0; i < list.length; i += maxRows) {
          const part = list.slice(i, i + maxRows);
          const data = await importGroup(groupId, part);
          const detailed = new Map((data.errors || []).map((e) => [e.row - 1, e.message]));
          const complete = (data.error_count || 0) <= detailed.size;
          part.forEach((item, idx) => {
            if (detailed.has(idx)) rejected.push({ id: item.id, message: detailed.get(idx) });
            else if (complete) accepted.push(item.id);
            else rejected.push({ id: item.id, message: 'RESOLVER no detalló esta fila; se reintenta.' });
          });
        }
      }
      return { accepted, rejected };
    },
  };
}
