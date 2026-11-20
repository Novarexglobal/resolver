// Control de calidad. Los errores impiden guardar la publicación (cuarentena); las advertencias se guardan con el registro.
import { dayIn, daysBetween, TIMEZONE } from './core/dates.js';
import { CURRENCIES } from './core/prices.js';

export const MAX_AGE_DAYS = 365;
export const SUSPICIOUS_PRICE = 1e9;

/** Comprobaciones que se hacen sobre un registro ya normalizado. Devuelve solo advertencias. */
export function checkRecord(record, now = new Date(), timeZone = TIMEZONE) {
  const issues = [];
  const warn = (field, message) => issues.push({ severity: 'warning', field, message });
  if (!CURRENCIES.includes(record.currency)) warn('currency', 'Moneda fuera del catálogo.');
  if (record.price > SUSPICIOUS_PRICE) warn('price', 'Precio muy alto: revisar.');
  if (record.published_at && daysBetween(record.published_at, dayIn(now, timeZone)) > MAX_AGE_DAYS) {
    warn('published_at', 'Publicación con más de un año.');
  }
  if (!record.source_url) warn('source_url', 'Sin enlace a la publicación original.');
  if (record.seller_contact && !/\d/.test(record.seller_contact)) warn('seller_contact', 'El contacto no parece un número de teléfono.');
  return issues;
}

/** 1 es sin advertencias; cada advertencia resta 0,1. Un registro con errores no llega a puntuarse. */
export function qualityScore(issues) {
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return Math.max(0, Math.round((1 - 0.1 * warnings) * 100) / 100);
}
