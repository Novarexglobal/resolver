import { normalizeText } from './analysis.js';
import { CATEGORY_TREE } from './config.js';

// Clasificación automática: solo se usa cuando la publicación no trae categoría.
// Es una sugerencia heurística y se guarda marcada como "sugerida".
const CATEGORY_KEYWORDS = [
  ['Celulares', /\b(iphone|celular|smartphone|galaxy|redmi|xiaomi|moto g|tecno|infinix|realme)\b/],
  ['Computadoras', /\b(laptop|portatil|computadora|macbook|notebook|monitor|teclado|all in one)\b/],
  ['Electrodomésticos', /\b(refrigerador|nevera|lavadora|ventilador|licuadora|microondas|batidora|aire acondicionado|split|cocina electrica)\b/],
  ['Electrónica', /\b(televisor|smart tv|bocina|audifonos|parlante|consola|playstation|xbox|tablet)\b/],
  ['Ropa y calzado', /\b(ropa|camisa|pantalon|zapatos|tenis|zapatillas|vestido|calzado|blusa)\b/],
  ['Hogar', /\b(sofa|mesa|silla|cama|colchon|cuna|estante|mueble|gabinete)\b/],
  ['Repuestos y accesorios', /\b(repuesto|funda|cargador|accesorio|bateria|pieza)\b/],
  ['Vehículos', /\b(carro|auto|vehiculo|jeep|camion)\b/],
  ['Motocicletas y bicicletas', /\b(moto|motocicleta|bicicleta|bici)\b/],
  ['Herramientas', /\b(taladro|herramienta|destornillador|sierra|martillo|llave inglesa)\b/],
  ['Deportes', /\b(pesas|balon|pelota|deportivo|raqueta)\b/],
];

// Marcas conocidas: solo se sugieren si la publicación no trae marca
const BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Motorola', 'LG', 'Nokia', 'Haier', 'Hisense', 'Lenovo', 'HP', 'Dell', 'Asus', 'Acer', 'Sony', 'Oppo', 'Realme', 'Tecno', 'Infinix', 'Nintendo'];

export function parentOf(name) {
  for (const top of CATEGORY_TREE) {
    if (top.name === name) return null;
    if (top.children.includes(name)) return top.name;
  }
  return null;
}

/** Sugiere categoría y marca a partir del texto. Devuelve null cuando no hay pistas claras. */
export function classifyText(text) {
  const haystack = normalizeText(text);
  const category = CATEGORY_KEYWORDS.find(([, re]) => re.test(haystack))?.[0] ?? null;
  const brand = BRANDS.find((b) => new RegExp(`\\b${normalizeText(b)}\\b`).test(haystack)) ?? null;
  return { category, brand };
}

/**
 * Completa categoría y marca de una publicación validada.
 * - Si trae categoría, se conserva si existe en el catálogo; si no, va a "Otros" y se guarda el texto original.
 * - Si no trae categoría, se sugiere por palabras clave (o "Otros").
 */
export function classifyPost(post, knownCategories) {
  const out = { ...post };
  const declared = (post.category || '').trim();
  const guess = classifyText(`${post.product} ${post.description ?? ''}`);
  if (declared) {
    if (knownCategories.has(declared)) {
      out.category_source = 'declarada';
    } else {
      out.category_declared = declared;
      out.category = 'Otros';
      out.category_source = 'no reconocida';
    }
  } else {
    out.category = guess.category || 'Otros';
    out.category_source = guess.category ? 'sugerida' : 'sin pista';
  }
  if (!post.brand && guess.brand) {
    out.brand = guess.brand;
    out.brand_source = 'sugerida';
  } else {
    out.brand_source = post.brand ? 'declarada' : 'sin dato';
  }
  return out;
}

/** Siembra el catálogo del módulo 7 sin borrar lo existente. Las categorías antiguas quedan activas y con su padre asignado. */
export function seedCatalog(store) {
  const existing = store.list('categories');
  for (const top of CATEGORY_TREE) {
    const topDoc = existing.find((c) => c.name === top.name);
    if (!topDoc) store.insert('categories', { name: top.name, parent: null, active: true });
    else if (topDoc.parent === undefined || topDoc.active === undefined) store.update('categories', topDoc.id, { parent: null, active: true });
    for (const child of top.children) {
      const doc = existing.find((c) => c.name === child);
      if (!doc) store.insert('categories', { name: child, parent: top.name, active: true });
      else if (doc.parent !== top.name || doc.active === undefined) store.update('categories', doc.id, { parent: top.name, active: true });
    }
  }
  // Categorías añadidas antes por el administrador que no están en el árbol: se mantienen como raíz
  for (const doc of store.list('categories')) {
    if (doc.parent === undefined) store.update('categories', doc.id, { parent: null, active: true });
  }
}

/** Nombres que cuenta una categoría en un filtro: ella misma y sus subcategorías activas. */
export function categoryScope(store, name) {
  if (!name) return null;
  const children = store.list('categories', (c) => c.parent === name && c.active !== false).map((c) => c.name);
  return [name, ...children];
}

export const SOURCE_SEED = [
  {
    key: 'facebook-manual',
    name: 'Grupos de Facebook (carga manual)',
    kind: 'manual',
    status: 'activa',
    note: 'El administrador copia las publicaciones de cada grupo registrado. No hay extracción automática.',
  },
  {
    key: 'revolico',
    name: 'Revolico (clasificados)',
    kind: 'pendiente',
    status: 'no conectada',
    note: 'No hay permiso verificado para acceso automatizado. Vías: carga manual o acuerdo de datos con Revolico.',
  },
  {
    key: 'api-oficial',
    name: 'API oficial de terceros',
    kind: 'pendiente',
    status: 'no conectada',
    note: 'Reservada para integraciones autorizadas. Requiere credenciales que aún no existen.',
  },
];

export function seedSources(store) {
  for (const src of SOURCE_SEED) {
    if (!store.get('sources', (s) => s.key === src.key)) store.insert('sources', src);
  }
}

// Planes futuros: preparados, sin activar ni bloquear funciones
export const PLANS = [
  { key: 'free', name: 'Free', active: true },
  { key: 'plus', name: 'Plus', active: false },
  { key: 'pro', name: 'Pro', active: false },
  { key: 'business', name: 'Business', active: false },
];
