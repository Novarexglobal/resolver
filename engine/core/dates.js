// Fechas de publicación. Se trabaja con el día del calendario de Cuba; la hora no se usa.
import { cleanText } from './text.js';

export const TIMEZONE = 'America/Havana';

/** Día (AAAA-MM-DD) de una fecha en la zona horaria indicada. */
export function dayIn(date, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Acepta AAAA-MM-DD (también con hora), DD/MM/AAAA y DD-MM-AAAA.
 * Rechaza fechas que no existen y fechas futuras respecto al día actual en Cuba.
 */
export function normalizeDay(raw, now = new Date(), timeZone = TIMEZONE) {
  const s = cleanText(raw, 40);
  if (!s) return { ok: false, day: null, error: 'Falta la fecha de publicación.' };
  let y;
  let m;
  let d;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (match) {
    [y, m, d] = match.slice(1).map(Number);
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    return { ok: false, day: null, error: 'Fecha no reconocida (use AAAA-MM-DD o DD/MM/AAAA).' };
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return { ok: false, day: null, error: 'La fecha no existe en el calendario.' };
  }
  const day = `${y}-${pad(m)}-${pad(d)}`;
  if (day > dayIn(now, timeZone)) return { ok: false, day: null, error: 'La fecha publicada es futura.' };
  return { ok: true, day, error: '' };
}

/** Diferencia en días entre dos días AAAA-MM-DD (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** Suma días a un día AAAA-MM-DD. */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}
