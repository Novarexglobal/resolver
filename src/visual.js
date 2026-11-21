// Identidad visual global: el superadministrador elige un estilo, un logo, un color de acento y la posición de la barra.
// Todo aplica a todas las personas. Los dibujos, nombres y colores de muestra viven en public/brand.js.
export const STYLE_IDS = ['cabina', 'brasa', 'musgo', 'hielo', 'papel', 'arena', 'neon', 'medianoche', 'bosque', 'tinta', 'confort', 'terminal', 'lienzo', 'orbita', 'pixel'];
export const LOGO_IDS = ['hexagono', 'anillo', 'gota', 'chispa', 'orbita', 'chip', 'cursor', 'corchetes', 'nodos', 'esquina', 'ojo', 'latido', 'cubo', 'barras', 'mira'];
export const BAR_IDS = ['abajo', 'arriba', 'izquierda', 'derecha'];
export const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_VISUAL = Object.freeze({ style: 'cabina', logo: 'hexagono', accent: '#3ee8ff', bar: 'abajo' });

// Devuelve siempre valores válidos, aunque la configuración guardada esté vacía o sea antigua
export function normalizeVisual(settings = {}) {
  const style = STYLE_IDS.includes(settings.visual_style) ? settings.visual_style : DEFAULT_VISUAL.style;
  const logo = LOGO_IDS.includes(settings.visual_logo) ? settings.visual_logo : DEFAULT_VISUAL.logo;
  const accent = ACCENT_RE.test(settings.visual_accent || '') ? settings.visual_accent.toLowerCase() : DEFAULT_VISUAL.accent;
  const bar = BAR_IDS.includes(settings.visual_bar) ? settings.visual_bar : DEFAULT_VISUAL.bar;
  return { style, logo, accent, bar };
}
