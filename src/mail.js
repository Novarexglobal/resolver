// Envío de correo mediante la API HTTP de Resend (sin dependencias). Sin clave configurada, no envía nada.
export async function sendMail({ apiKey, from, to, subject, text, fetchImpl = fetch }) {
  if (!apiKey || !from) return { sent: false, reason: 'El correo no está configurado en el servidor.' };
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) return { sent: false, reason: `El servicio de correo respondió ${res.status}.` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: `No se pudo contactar el servicio de correo: ${err.message}` };
  }
}
