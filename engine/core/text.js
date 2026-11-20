// Texto: limpieza, comparación sin acentos y claves de producto.

/** Quita controles, colapsa espacios y recorta. Nunca devuelve algo que no sea texto. */
export function cleanText(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Forma comparable: minúsculas, sin acentos, sin símbolos. "Lavadora Mabe" → "lavadora mabe". */
export function foldText(value) {
  return cleanText(value, 20000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras que no distinguen un producto de otro
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'para', 'por', 'un', 'una',
  'nuevo', 'nueva', 'usado', 'usada', 'vendo', 'vende', 'se', 'ocasion', 'oferta',
]);

/** Clave estable de producto para agrupar: "Vendo Lavadora de 7kg" y "lavadora 7kg" comparten clave. */
export function productKeyOf(name) {
  return foldText(name)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ');
}

/** Cadena de frase para buscar palabras completas dentro de un texto ya plegado. */
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cuenta cuántas veces aparece cada palabra completa de la lista en el texto plegado. */
export function countWords(foldedText, words) {
  let total = 0;
  for (const word of words) {
    const re = new RegExp(`(^| )${escapeRegExp(foldText(word))}( |$)`, 'g');
    total += (foldedText.match(re) || []).length;
  }
  return total;
}
