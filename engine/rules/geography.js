// Clasificación geográfica. Reglas propias del motor; deben mantenerse iguales a las provincias de RESOLVER (lo comprueba una prueba).
import { cleanText, foldText, countWords } from '../core/text.js';

export const PROVINCES = [
  'Pinar del Río',
  'Artemisa',
  'La Habana',
  'Mayabeque',
  'Matanzas',
  'Villa Clara',
  'Cienfuegos',
  'Sancti Spíritus',
  'Ciego de Ávila',
  'Camagüey',
  'Las Tunas',
  'Holguín',
  'Granma',
  'Santiago de Cuba',
  'Guantánamo',
  'Isla de la Juventud',
];

// Formas escritas frecuentes que se aceptan como la provincia oficial
export const PROVINCE_ALIASES = {
  habana: 'La Habana',
  'ciudad habana': 'La Habana',
  'ciudad de la habana': 'La Habana',
  'isla juventud': 'Isla de la Juventud',
  'pinar del rio': 'Pinar del Río',
  pinar: 'Pinar del Río',
  'sancti spiritus': 'Sancti Spíritus',
  'ciego de avila': 'Ciego de Ávila',
  camaguey: 'Camagüey',
  guantanamo: 'Guantánamo',
  holguin: 'Holguín',
  santiago: 'Santiago de Cuba',
};

/**
 * Municipio (plegado) → provincia. Vacío a propósito: se llena con datos verificados.
 * Un municipio ambiguo (en dos provincias) no debe estar aquí.
 */
export const MUNICIPALITY_INDEX = {};

const index = new Map();
for (const p of PROVINCES) index.set(foldText(p), p);
for (const [alias, p] of Object.entries(PROVINCE_ALIASES)) index.set(foldText(alias), p);

/** Provincia a partir de un texto escrito por la fuente. Devuelve null si no se reconoce. */
export function provinceOf(value) {
  return index.get(foldText(value)) || null;
}

/**
 * Clasifica la ubicación:
 * 1. Provincia declarada (o alias) → «declarada» / «alias».
 * 2. Sin provincia, municipio conocido en MUNICIPALITY_INDEX → «inferida por municipio».
 * 3. Sin provincia, exactamente una provincia nombrada en el texto → «inferida por texto».
 * 4. Si no, sin clasificar: el registro va a cuarentena.
 */
export function classifyGeo({ province = '', municipality = '', text = '' } = {}) {
  const municipalityName = cleanText(municipality, 80);
  const declared = cleanText(province, 80);
  if (declared) {
    const found = provinceOf(declared);
    if (found) {
      return {
        province: found,
        province_source: foldText(declared) === foldText(found) ? 'declarada' : 'alias',
        municipality: municipalityName,
        note: '',
      };
    }
    return { province: null, province_source: 'sin clasificar', municipality: municipalityName, note: `Provincia no reconocida: "${declared}".` };
  }
  const byMunicipality = MUNICIPALITY_INDEX[foldText(municipalityName)];
  if (byMunicipality) {
    return { province: byMunicipality, province_source: 'inferida por municipio', municipality: municipalityName, note: '' };
  }
  const folded = foldText(text);
  const mentioned = PROVINCES.filter((p) => countWords(folded, [p]) > 0);
  if (mentioned.length === 1) {
    return { province: mentioned[0], province_source: 'inferida por texto', municipality: municipalityName, note: '' };
  }
  return { province: null, province_source: 'sin clasificar', municipality: municipalityName, note: 'Sin provincia declarada ni reconocible en el texto.' };
}
