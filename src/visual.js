// Identidad visual global: el superadministrador elige un estilo y un logo; aplican a todas las personas.
// Los nombres, descripciones y dibujos viven en public/brand.js. Aquí solo se validan los identificadores.
export const STYLE_IDS = ['cabina', 'brasa', 'musgo', 'hielo', 'papel', 'arena', 'neon', 'medianoche', 'bosque', 'tinta'];
export const LOGO_IDS = ['hexagono', 'anillo', 'burbuja', 'gota', 'arco', 'lente', 'etiqueta', 'pulso', 'avance', 'radar', 'puntos', 'rombo'];
export const DEFAULT_VISUAL = Object.freeze({ style: 'cabina', logo: 'hexagono' });

// Devuelve siempre un estilo y un logo válidos, aunque la configuración guardada esté vacía o sea antigua
export function normalizeVisual(settings = {}) {
  const style = STYLE_IDS.includes(settings.visual_style) ? settings.visual_style : DEFAULT_VISUAL.style;
  const logo = LOGO_IDS.includes(settings.visual_logo) ? settings.visual_logo : DEFAULT_VISUAL.logo;
  return { style, logo };
}
