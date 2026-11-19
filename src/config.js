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

// Estructura jerárquica del módulo 7. Las subcategorías antiguas (Celulares, Computadoras, Hogar...) se conservan bajo su padre.
export const CATEGORY_TREE = [
  { name: 'Tecnología y teléfonos', children: ['Celulares', 'Electrónica'] },
  { name: 'Electrodomésticos', children: [] },
  { name: 'Informática', children: ['Computadoras'] },
  { name: 'Vehículos', children: [] },
  { name: 'Motocicletas y bicicletas', children: [] },
  { name: 'Hogar y muebles', children: ['Hogar'] },
  { name: 'Ropa y calzado', children: [] },
  { name: 'Belleza y cuidado personal', children: [] },
  { name: 'Alimentación', children: [] },
  { name: 'Ferretería y construcción', children: [] },
  { name: 'Herramientas', children: [] },
  { name: 'Deportes', children: [] },
  { name: 'Repuestos y accesorios', children: [] },
  { name: 'Otros', children: [] },
];

// Plazo de un enlace de recuperación de contraseña
export const RECOVERY_MINUTES = 30;

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
  // Correo para recuperar contraseña (Resend). Sin estas variables, la recuperación queda registrada para el administrador.
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.RESOLVER_MAIL_FROM || '',
  appUrl: process.env.RESOLVER_APP_URL || '',
};
