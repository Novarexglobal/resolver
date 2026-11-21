// Identidad visual global: el superadministrador elige un estilo, un logo y un color de acento.
// Todo aplica a todas las personas. Los dibujos, nombres y colores de muestra viven en public/brand.js.
export const STYLE_IDS = ['cabina', 'brasa', 'musgo', 'hielo', 'papel', 'arena', 'neon', 'medianoche', 'bosque', 'tinta'];
export const LOGO_IDS = ['hexagono', 'anillo', 'burbuja', 'gota', 'arco', 'lente', 'etiqueta', 'pulso', 'avance', 'radar', 'puntos', 'rombo'];
export const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_VISUAL = Object.freeze({ style: 'cabina', logo: 'hexagono', accent: '#3ee8ff' });

// Devuelve siempre un estilo, logo y acento válidos, aunque la configuración guardada esté vacía o sea antigua
export function normalizeVisual(settings = {}) {
  const style = STYLE_IDS.includes(settings.visual_style) ? settings.visual_style : DEFAULT_VISUAL.style;
  const logo = LOGO_IDS.includes(settings.visual_logo) ? settings.visual_logo : DEFAULT_VISUAL.logo;
  const accent = ACCENT_RE.test(settings.visual_accent || '') ? settings.visual_accent.toLowerCase() : DEFAULT_VISUAL.accent;
  return { style, logo, accent };
}
