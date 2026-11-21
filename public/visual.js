// Aplica el estilo visual y el logo que eligió el superadministrador. Vale para la app y para el panel.
import { logoMarkup } from './brand.js';

export const DEFAULT_VISUAL = { style: 'cabina', logo: 'hexagono' };

// Pone el estilo en la raíz y dibuja el logo en cada hueco [data-logo] ("hero" anima el trazo al entrar)
export function applyVisual(visual) {
  const v = { ...DEFAULT_VISUAL, ...(visual || {}) };
  document.documentElement.setAttribute('data-style', v.style);
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
