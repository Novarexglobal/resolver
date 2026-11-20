// Precios y monedas. Nada se completa ni se convierte: lo que no se entiende se marca para revisión.
import { cleanText, foldText } from './text.js';

export const CURRENCIES = ['CUP', 'USD', 'MLC', 'EUR'];
export const MAX_PRICE = 1e12;

// Formas escritas que se reconocen sin ambigüedad
const CURRENCY_WORDS = {
  cup: 'CUP',
  mn: 'CUP',
  'moneda nacional': 'CUP',
  usd: 'USD',
  us: 'USD',
  dolar: 'USD',
  dolares: 'USD',
  mlc: 'MLC',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
};

/**
 * Moneda de una publicación.
 * - Vacía: se usa la moneda por defecto y se marca como «por defecto».
 * - "$" solo: ambigua (en Cuba puede ser CUP o USD). Se marca para revisión, no se adivina.
 * - Forma reconocida: se usa y se marca como «declarada».
 */
export function normalizeCurrency(raw, defaultCurrency = 'CUP') {
  const text = cleanText(raw, 20);
  if (!text) return { ok: true, currency: defaultCurrency, source: 'por defecto', note: '' };
  if (text === '$') {
    return { ok: false, currency: null, source: 'ambigua', note: 'El símbolo $ puede ser CUP o USD: hay que indicar la moneda.' };
  }
  const key = foldText(text);
  const found = CURRENCY_WORDS[key] || (CURRENCIES.includes(text.toUpperCase()) ? text.toUpperCase() : null);
  if (found) return { ok: true, currency: found, source: 'declarada', note: '' };
  return { ok: false, currency: null, source: 'no reconocida', note: `Moneda no reconocida: "${text}".` };
}

/**
 * Número de un precio. Acepta "1.200,50", "1,200.50", "1,200", "1.200", "950,5", "300 000" y "$ 300".
 * Los separadores se interpretan por su posición: el último con dos decimales es el decimal.
 */
export function parsePrice(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 && raw <= MAX_PRICE
      ? { ok: true, value: Math.round(raw * 100) / 100, note: '' }
      : { ok: false, value: null, error: 'El precio debe ser un número mayor que 0.' };
  }
  let s = cleanText(raw, 60).toLowerCase();
  if (!s) return { ok: false, value: null, error: 'Falta el precio.' };
  if (s.includes('-')) return { ok: false, value: null, error: 'El precio no puede ser negativo ni un rango.' };
  // Notación científica o letras entre cifras ("1e15", "3k2"): no se adivina
  if (/\d\s*[a-z]+\s*\d/.test(s)) return { ok: false, value: null, error: 'El precio tiene un formato no reconocido.' };
  // Se quitan letras y símbolos ("$", "usd", "cup"); los espacios son separador de miles
  s = s.replace(/[^\d.,\s]/g, '').replace(/\s+/g, '');
  if (!s || !/\d/.test(s)) return { ok: false, value: null, error: 'El precio no contiene un número.' };

  let normalized;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = s.split(',').length - 1;
    const fraction = s.length - lastComma - 1;
    if (commas > 1 || fraction === 3) normalized = s.replace(/,/g, '');
    else normalized = s.replace(',', '.');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    normalized = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? s.replace(/\./g, '') : s;
  } else {
    normalized = s;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, value: null, error: 'El precio no es un número válido.' };
  if (value > MAX_PRICE) return { ok: false, value: null, error: 'El precio supera el límite permitido.' };
  return {
    ok: true,
    value: Math.round(value * 100) / 100,
    note: normalized !== s ? `Formato de precio interpretado como ${normalized}.` : '',
  };
}
