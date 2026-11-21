// Marca de RESOLVER: 15 logos, 15 estilos visuales y 4 posiciones de barra. Todo es dibujo fijo; no entra ningún dato de usuario aquí.
// Cada logo es una lista de trazos en un lienzo de 512 × 512. El color del trazo es el texto actual (currentColor)
// y el nodo luminoso usa el acento elegido por el superadministrador (var(--accent)).

export const LOGOS = [
  { id: 'hexagono', name: 'Hexágono', items: [
    { p: 'M256 36L446.5 146V366L256 476L65.5 366V146Z', w: 22 },
    { p: 'M190 132V352', w: 36 },
    { p: 'M190 150H270L316 200L270 250H190', w: 36 },
    { p: 'M270 250L330 362', w: 36 },
    { c: [330, 362, 20], f: 'accent' },
  ] },
  { id: 'anillo', name: 'Anillo', items: [
    { c: [256, 256, 210], w: 22, dash: '1099.3 220' },
    { c: [437.9, 151, 18], f: 'accent' },
    { p: 'M190 140V352', w: 40, tr: 'translate(4 10)' },
    { p: 'M190 160H258A52 52 0 0 1 258 264H190', w: 40, tr: 'translate(4 10)' },
    { p: 'M258 264L316 332', w: 40, tr: 'translate(4 10)' },
  ] },
  { id: 'gota', name: 'Gota', items: [
    { p: 'M256 40C360 160 412 230 412 318A156 156 0 0 1 100 318C100 230 152 160 256 40Z', w: 22 },
    { p: 'M206 356V230H250A34 34 0 0 1 250 298H206', w: 30, lj: 'round' },
    { p: 'M250 298L300 356', w: 30 },
    { c: [300, 356, 14], f: 'accent' },
  ] },
  { id: 'chispa', name: 'Chispa', items: [
    { p: 'M256 60L290 222L452 256L290 290L256 452L222 290L60 256L222 222Z', w: 22, lj: 'round' },
    { c: [256, 256, 26], f: 'accent' },
  ] },
  { id: 'orbita', name: 'Órbita', items: [
    { e: [256, 256, 200, 90], rot: -25, w: 18 },
    { e: [256, 256, 200, 90], rot: 35, w: 10, op: 0.45 },
    { c: [256, 256, 46], f: 'ink' },
    { c: [437, 171, 18], f: 'accent' },
  ] },
  { id: 'chip', name: 'Chip', items: [
    { r: [136, 136, 240, 240, 28], w: 22 },
    { p: 'M196 96V136M256 96V136M316 96V136M196 376V416M256 376V416M316 376V416M96 196H136M96 256H136M96 316H136M376 196H416M376 256H416M376 316H416', w: 18, lc: 'round' },
    { c: [256, 256, 34], f: 'accent' },
  ] },
  { id: 'cursor', name: 'Cursor', items: [
    { p: 'M170 90V380L240 316L290 420L340 398L290 296H392Z', w: 22, lj: 'round' },
    { c: [400, 110, 20], f: 'accent' },
  ] },
  { id: 'corchetes', name: 'Corchetes', items: [
    { p: 'M176 150L96 256L176 362', w: 40, lj: 'round', lc: 'round' },
    { p: 'M336 150L416 256L336 362', w: 40, lj: 'round', lc: 'round' },
    { p: 'M290 130L222 382', w: 30, lc: 'round', col: 'accent' },
  ] },
  { id: 'nodos', name: 'Nodos', items: [
    { p: 'M256 256L128 128M256 256L384 128M256 256L256 400', w: 18, lc: 'round' },
    { c: [128, 128, 40], w: 18 },
    { c: [384, 128, 40], w: 18 },
    { c: [256, 400, 40], w: 18 },
    { c: [256, 256, 56], f: 'accent' },
  ] },
  { id: 'esquina', name: 'Esquina', items: [
    { p: 'M96 200V96H200', w: 36 },
    { p: 'M312 96H416V200', w: 36 },
    { p: 'M416 312V416H312', w: 36 },
    { p: 'M200 416H96V312', w: 36 },
    { c: [256, 256, 44], f: 'accent' },
  ] },
  { id: 'ojo', name: 'Ojo', items: [
    { p: 'M56 256C128 146 384 146 456 256C384 366 128 366 56 256Z', w: 22, lj: 'round' },
    { c: [256, 256, 80], w: 22 },
    { c: [256, 256, 34], f: 'accent' },
  ] },
  { id: 'latido', name: 'Latido', items: [
    { r: [56, 56, 400, 400, 96], w: 22 },
    { p: 'M96 276H190L226 200L268 336L302 246L326 276H416', w: 26, lj: 'round', lc: 'round' },
    { c: [416, 276, 18], f: 'accent' },
  ] },
  { id: 'cubo', name: 'Cubo', items: [
    { p: 'M256 60L430 160V352L256 452L82 352V160Z', w: 22, lj: 'round' },
    { p: 'M82 160L256 260L430 160', w: 22, lj: 'round' },
    { p: 'M256 260V452', w: 22 },
    { c: [256, 260, 26], f: 'accent' },
  ] },
  { id: 'barras', name: 'Barras', items: [
    { p: 'M124 400V316', w: 56 },
    { p: 'M212 400V248', w: 56 },
    { p: 'M300 400V196', w: 56 },
    { p: 'M388 400V120', w: 56, col: 'accent' },
  ] },
  { id: 'mira', name: 'Mira', items: [
    { c: [256, 256, 190], w: 22 },
    { c: [256, 256, 110], w: 22, op: 0.6 },
    { p: 'M256 40V152M256 360V472M40 256H152M360 256H472', w: 22, lc: 'round' },
    { c: [256, 256, 34], f: 'accent' },
  ] },
];

// Estilos: forma, tipografía, fondo, tarjetas, barra y transición. El color lo elige el superadministrador aparte.
export const STYLES = [
  { id: 'cabina', name: 'Cabina', desc: 'Panel técnico: filos finos, sellos y cabinas de fondo, la pantalla se barre al cambiar de módulo.' },
  { id: 'brasa', name: 'Brasa', desc: 'Bloque audaz: bordes gruesos, sombras duras, cambio de módulo a golpe.' },
  { id: 'musgo', name: 'Musgo', desc: 'Suave y orgánico: esquinas muy redondas, barra flotante, cambio con rebote.' },
  { id: 'hielo', name: 'Hielo', desc: 'Vidrio esmerilado: tarjetas translúcidas, fondo difuminado, cambio con desenfoque.' },
  { id: 'papel', name: 'Papel', desc: 'Editorial impreso: serif en todo, sin tarjetas, reglas finas, página que gira.' },
  { id: 'arena', name: 'Arena', desc: 'Juguetón y cercano: tarjetas muy redondeadas, sombra de color, cambio con salto.' },
  { id: 'neon', name: 'Neón', desc: 'Tablero de neón: bordes que brillan, horizonte de rejilla, cambio con parpadeo.' },
  { id: 'medianoche', name: 'Medianoche', desc: 'Lujo nocturno: títulos en serif, viñeta oscura, cambio lento con zoom suave.' },
  { id: 'bosque', name: 'Bosque', desc: 'Calmo y ordenado: hojas de fondo, filo de color a la izquierda, cambio que baja.' },
  { id: 'tinta', name: 'Tinta', desc: 'Mínimo monocromo: sin color decorativo, cifras en monoespaciada, cambio seco.' },
  { id: 'confort', name: 'Confort', desc: 'General y cómodo: tarjetas suaves, espacios amplios, cambio de módulo con fundido corto.' },
  { id: 'terminal', name: 'Terminal', desc: 'Consola: monoespaciada, cursor parpadeante, cambio con barrido de líneas.' },
  { id: 'lienzo', name: 'Lienzo', desc: 'Galería clara: tarjetas blancas con sombra fina, mucho aire, cambio con deslizado.' },
  { id: 'orbita', name: 'Órbita', desc: 'Espacial: halo de anillos, paneles de cristal oscuro, cambio con giro orbital.' },
  { id: 'pixel', name: 'Pixel', desc: 'Retro digital: bordes cuadrados, sombra escalonada, cambio con mosaico de píxeles.' },
];

// Posiciones de la barra de herramientas que puede elegir el superadministrador
export const BAR_CHOICES = [
  { id: 'abajo', name: 'Abajo', desc: 'Como una app de teléfono: la barra queda al pie.' },
  { id: 'arriba', name: 'Arriba', desc: 'Barra fija en la parte superior, con los módulos en línea.' },
  { id: 'izquierda', name: 'Izquierda', desc: 'Columna lateral izquierda con los módulos en vertical.' },
  { id: 'derecha', name: 'Derecha', desc: 'Columna lateral derecha con los módulos en vertical.' },
];

// Colores de acento sugeridos. Cualquier estilo puede usar cualquiera, y también un color libre.
export const ACCENT_COLORS = [
  '#3ee8ff', '#ff7a3d', '#7fe3a1', '#6d8dff',
  '#c9a46a', '#e0a458', '#e8b98a', '#ef8a5c',
  '#7b2cff', '#ff4fd8', '#1f3a8a', '#f2c14e',
  '#1f5a3d', '#b8f25c', '#9aa3ad', '#ffd23f',
];

const NS = 'http://www.w3.org/2000/svg';
const DRAW_STEP_MS = 110;

// Devuelve el SVG del logo. Con animated, los trazos se dibujan en secuencia y el nodo aparece al final.
export function logoMarkup(id, { animated = false } = {}) {
  const logo = LOGOS.find((l) => l.id === id) || LOGOS[0];
  const delayOf = (i) => `animation-delay:${i * DRAW_STEP_MS}ms`;
  const parts = logo.items.map((it, i) => {
    const tr = it.tr || (it.rot != null ? `rotate(${it.rot} 256 256)` : '');
    const trAttr = tr ? ` transform="${tr}"` : '';
    const op = it.op != null ? ` opacity="${it.op}"` : '';
    if (it.p) {
      const cls = animated ? 'draw' : '';
      const style = animated ? ` style="${delayOf(i)}"` : '';
      const lj = it.lj ? ` stroke-linejoin="${it.lj}"` : '';
      const lc = it.lc ? ` stroke-linecap="${it.lc}"` : '';
      const color = it.col === 'accent' ? 'var(--accent)' : 'currentColor';
      return `<path class="${cls}" pathLength="1" d="${it.p}" stroke="${color}" stroke-width="${it.w}"${lj}${lc}${trAttr}${op}${style}/>`;
    }
    if (it.r) {
      const [x, y, w, h, rx] = it.r;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="currentColor" stroke-width="${it.w}"${op}/>`;
    }
    if (it.e) {
      const [cx, cy, rx, ry] = it.e;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="currentColor" stroke-width="${it.w}"${trAttr}${op}/>`;
    }
    const [cx, cy, r] = it.c;
    if (it.f) {
      const accent = it.f === 'accent';
      const cls = accent ? 'node' : '';
      const dot = accent && animated ? ' dot-end' : '';
      const style = accent ? ` style="fill:var(--accent);${animated ? delayOf(logo.items.length) : ''}"` : ' fill="currentColor"';
      return `<circle class="${cls}${dot}" cx="${cx}" cy="${cy}" r="${r}" stroke="none"${style}${op}${trAttr}/>`;
    }
    const dash = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${it.w}"${dash}${op}/>`;
  });
  return `<svg xmlns="${NS}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}
