import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');

// 15 provincias + Isla de la Juventud (municipio especial)
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

// Categorías configurables: se pueden ampliar desde el panel de administración
export const DEFAULT_CATEGORIES = [
  'Celulares',
  'Computadoras',
  'Electrodomésticos',
  'Electrónica',
  'Ropa y calzado',
  'Hogar',
  'Otros',
];

export const CURRENCIES = ['CUP', 'USD', 'MLC', 'EUR'];

export const MAX_PERIOD_DAYS = 30;
// Mínimo de publicaciones para mostrar estadísticas de precio con confianza
export const MIN_OBSERVATIONS = 3;
// Mínimo de fechas distintas para mostrar evolución
export const MIN_DISTINCT_DAYS = 2;

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataFile: process.env.RESOLVER_DATA_FILE || join(ROOT, 'data', 'resolver.json'),
  publicDir: join(ROOT, 'public'),
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  secureCookies: process.env.COOKIE_SECURE === 'true',
  // Si están definidas, los datos se guardan en Supabase (permanente). Si no, en archivo local.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',
  // Solo para crear el superadministrador en un hosting sin consola (si aún no existe)
  bootstrapUser: process.env.RESOLVER_ADMIN_USER || '',
  bootstrapPassword: process.env.RESOLVER_ADMIN_PASSWORD || '',
};
