// Marca de RESOLVER: 12 logos y 10 estilos visuales. Todo es dibujo fijo; no entra ningún dato de usuario aquí.
// Cada logo es una lista de trazos en un lienzo de 512 × 512. El color del trazo es el texto actual (currentColor)
// y el nodo luminoso usa el acento del estilo activo (var(--accent)).

const R_DOT_ROWS = ['11110', '10001', '10001', '11110', '10100', '10010', '10001'];
const dotMatrix = () => {
  const items = [];
  R_DOT_ROWS.forEach((row, r) => [...row].forEach((on, c) => {
    if (on !== '1') return;
    const accent = r === 6 && c === 4;
    items.push({ c: [120 + c * 68, 88 + r * 56, 18], f: accent ? 'accent' : 'ink' });
  }));
  return items;
};

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
  { id: 'burbuja', name: 'Burbuja', items: [
    { r: [72, 72, 368, 368, 120], w: 22 },
    { p: 'M196 360V168H268A60 60 0 0 1 268 288H196', w: 34, lj: 'round' },
    { p: 'M268 288L332 360', w: 34, lj: 'round' },
    { c: [340, 170, 18], f: 'accent' },
  ] },
  { id: 'gota', name: 'Gota', items: [
    { p: 'M256 40C360 160 412 230 412 318A156 156 0 0 1 100 318C100 230 152 160 256 40Z', w: 22 },
    { p: 'M206 356V230H250A34 34 0 0 1 250 298H206', w: 30, lj: 'round' },
    { p: 'M250 298L300 356', w: 30 },
    { c: [300, 356, 14], f: 'accent' },
  ] },
  { id: 'arco', name: 'Arco', items: [
    { p: 'M180 380V132H290A90 90 0 0 1 290 312H180', w: 40, lj: 'round', tr: 'translate(-24 0)' },
    { p: 'M290 312L350 380', w: 40, tr: 'translate(-24 0)' },
    { c: [326, 380, 18], f: 'accent' },
  ] },
  { id: 'lente', name: 'Lente', items: [
    { c: [230, 230, 150], w: 26 },
    { p: 'M338 338L430 430', w: 36, lj: 'round' },
    { c: [230, 230, 46], f: 'accent' },
  ] },
  { id: 'etiqueta', name: 'Etiqueta', items: [
    { p: 'M120 256L232 144H400V368H232Z', w: 22, lj: 'round' },
    { c: [196, 256, 20], f: 'accent' },
    { p: 'M270 220H360', w: 18, lj: 'round' },
    { p: 'M270 292H340', w: 18, lj: 'round' },
  ] },
  { id: 'pulso', name: 'Pulso', items: [
    { p: 'M170 380V132H250A72 72 0 0 1 250 276H170', w: 36, lj: 'round' },
    { p: 'M250 276L300 330L330 290L372 380', w: 28, lj: 'round', lc: 'round', col: 'accent' },
    { c: [372, 380, 18], f: 'accent' },
  ] },
  { id: 'avance', name: 'Avance', items: [
    { p: 'M126 150L286 256L126 362', w: 40, lj: 'round', lc: 'round' },
    { p: 'M222 150L382 256L222 362', w: 40, lj: 'round', lc: 'round', op: 0.42 },
    { c: [382, 256, 24], f: 'accent' },
  ] },
  { id: 'radar', name: 'Radar', items: [
    { c: [256, 256, 200], w: 6, op: 0.35 },
    { c: [256, 256, 132], w: 8, op: 0.55 },
    { c: [256, 256, 68], w: 12, op: 0.8 },
    { p: 'M256 256L400 130', w: 14, lc: 'round', col: 'accent' },
    { c: [256, 256, 30], f: 'accent' },
  ] },
  { id: 'puntos', name: 'Puntos', items: dotMatrix() },
  { id: 'rombo', name: 'Rombo', items: [
    { p: 'M256 40L472 256L256 472L40 256Z', w: 22, lj: 'round' },
    { p: 'M200 342V170H262L300 210L262 250H200', w: 30, lj: 'round' },
    { p: 'M262 250L316 342', w: 30 },
    { c: [316, 342, 15], f: 'accent' },
  ] },
];

// Estilos: el nombre, la descripción y los dos colores de muestra. Los valores completos están en styles.css
export const STYLES = [
  { id: 'cabina', name: 'Cabina', desc: 'Grafito con cian eléctrico. El estilo original.', tint: '#3ee8ff', accent: '#3ee8ff' },
  { id: 'brasa', name: 'Brasa', desc: 'Grafito con naranja encendido.', tint: '#ff7a3d', accent: '#ff7a3d' },
  { id: 'musgo', name: 'Musgo', desc: 'Negro verdoso con verde menta.', tint: '#7fe3a1', accent: '#7fe3a1' },
  { id: 'hielo', name: 'Hielo', desc: 'Azul acero con azul eléctrico.', tint: '#6d8dff', accent: '#6d8dff' },
  { id: 'papel', name: 'Papel', desc: 'Tono cálido, títulos con serif y filos rectos. Serio y editorial.', tint: '#c9a46a', accent: '#e0a458' },
  { id: 'arena', name: 'Arena', desc: 'Esquinas redondeadas y coral suave. Cercano y relajado.', tint: '#e8b98a', accent: '#ef8a5c' },
  { id: 'neon', name: 'Neón', desc: 'Violeta profundo con magenta brillante.', tint: '#7b2cff', accent: '#ff4fd8' },
  { id: 'medianoche', name: 'Medianoche', desc: 'Azul marino con dorado.', tint: '#1f3a8a', accent: '#f2c14e' },
  { id: 'bosque', name: 'Bosque', desc: 'Verde profundo con lima.', tint: '#1f5a3d', accent: '#b8f25c' },
  { id: 'tinta', name: 'Tinta', desc: 'Casi monocromo, filos rectos y un solo acento ámbar.', tint: '#9aa3ad', accent: '#ffd23f' },
];

const NS = 'http://www.w3.org/2000/svg';
const DRAW_STEP_MS = 110;

// Devuelve el SVG del logo. Con animated, los trazos se dibujan en secuencia y el nodo aparece al final.
export function logoMarkup(id, { animated = false } = {}) {
  const logo = LOGOS.find((l) => l.id === id) || LOGOS[0];
  const delayOf = (i) => `animation-delay:${i * DRAW_STEP_MS}ms`;
  const parts = logo.items.map((it, i) => {
    const tr = it.tr ? ` transform="${it.tr}"` : '';
    const op = it.op != null ? ` opacity="${it.op}"` : '';
    if (it.p) {
      const cls = animated ? 'draw' : '';
      const style = animated ? ` style="${delayOf(i)}"` : '';
      const lj = it.lj ? ` stroke-linejoin="${it.lj}"` : '';
      const lc = it.lc ? ` stroke-linecap="${it.lc}"` : '';
      const color = it.col === 'accent' ? 'var(--accent)' : 'currentColor';
      return `<path class="${cls}" pathLength="1" d="${it.p}" stroke="${color}" stroke-width="${it.w}"${lj}${lc}${tr}${op}${style}/>`;
    }
    if (it.r) {
      const [x, y, w, h, rx] = it.r;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="currentColor" stroke-width="${it.w}"${op}/>`;
    }
    const [cx, cy, r] = it.c;
    if (it.f) {
      const accent = it.f === 'accent';
      const cls = accent ? 'node' : '';
      const dot = accent && animated ? ' dot-end' : '';
      const style = accent ? ` style="fill:var(--accent);${animated ? delayOf(logo.items.length) : ''}"` : ' fill="currentColor"';
      return `<circle class="${cls}${dot}" cx="${cx}" cy="${cy}" r="${r}" stroke="none"${style}${op}${tr}/>`;
    }
    const dash = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${it.w}"${dash}${op}/>`;
  });
  const svg = `<svg xmlns="${NS}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
  return svg;
}
