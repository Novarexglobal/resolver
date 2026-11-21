// Aplica el estilo, el logo y el color de acento que eligió el superadministrador. Vale para la app y para el panel.
import { logoMarkup } from './brand.js';

export const DEFAULT_VISUAL = { style: 'cabina', logo: 'hexagono', accent: '#3ee8ff' };

// Texto legible sobre el acento: oscuro si el color es claro, blanco si es oscuro
export function onAccentFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#04121a' : '#ffffff';
}

// Pone el estilo y el acento en la raíz y dibuja el logo en cada hueco [data-logo] ("hero" anima el trazo al entrar)
export function applyVisual(visual) {
  const v = { ...DEFAULT_VISUAL, ...(visual || {}) };
  const root = document.documentElement;
  root.setAttribute('data-style', v.style);
  root.style.setProperty('--accent', v.accent);
  root.style.setProperty('--on-accent', onAccentFor(v.accent));
  document.querySelectorAll('[data-logo]').forEach((slot) => {
    slot.innerHTML = logoMarkup(v.logo, { animated: slot.dataset.logo === 'hero' });
  });
  return v;
}

// Lee la elección global desde la configuración pública. Si falla, se queda con el estilo por defecto.
export async function loadVisual() {
  try {
    const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('configuración no disponible');
    const cfg = await res.json();
    return applyVisual(cfg.visual);
  } catch {
    return applyVisual(DEFAULT_VISUAL);
  }
}
