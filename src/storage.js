// Fotos de publicaciones en Supabase Storage (API REST, sin dependencias).
// El tipo de imagen se decide por los bytes, nunca por la cabecera que envía el navegador.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const SIGNATURES = [
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Devuelve { type, ext } si los bytes son JPEG, PNG o WebP; si no, null. */
export function detectImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { type: hit.type, ext: hit.ext } : null;
}

/** Ruta del objeto dentro del bucket: una por foto, nunca sobrescribe otra. */
export function objectPath(postId, ext, unique) {
  const safe = String(postId).replace(/[^a-zA-Z0-9_-]/g, '');
  return `publicaciones/${safe}-${unique}.${ext}`;
}

export function publicUrl(baseUrl, bucket, path) {
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Sube la imagen. Devuelve { sent: true, url } o { sent: false, reason }.
 * Sin Supabase configurado no hace nada y lo dice.
 */
export async function uploadImage({ baseUrl, key, bucket, path, bytes, contentType, fetchImpl = fetch }) {
  if (!baseUrl || !key) return { sent: false, reason: 'Las fotos requieren Supabase Storage configurado (SUPABASE_URL y SUPABASE_SERVICE_KEY).' };
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
        'Cache-Control': 'public, max-age=31536000',
      },
      body: bytes,
    });
    if (!res.ok) return { sent: false, reason: `Supabase Storage respondió ${res.status}. Revisa que exista el bucket "${bucket}" y que sea público.` };
    return { sent: true, url: publicUrl(baseUrl, bucket, path) };
  } catch (err) {
    return { sent: false, reason: `No se pudo contactar Supabase Storage: ${err.message}` };
  }
}
