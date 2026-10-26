// Órbita — a paleta da cena: uma só fonte de verdade para a cor de cada sala.
//
// Porque existe (26 out 2026). O chão de cada sala passou a ser vidro colorido, e a mesma cor
// tem de servir três sítios que não se falam: a laje do chão (builders.js), a banda de vidro das
// paredes (builders.js) e o filete do cartão da sala (main.js). Se cada sítio inventasse o seu
// tom, o escritório deixava de dizer a mesma cor duas vezes — e as melhorias de amanhã voltavam a
// ter de adivinhar onde está «a» cor.
//
// Puro de propósito: sem `three`, sem DOM. Corre no servidor (serve.mjs partilha data.js) e em
// `node --test` sem harness nenhum — é isso que permite testar as cores que o dono pediu.

/* ---------- cor: rgb ↔ hex, mistura, escurecer, clarear ---------- */

const clamp255 = (v) => Math.min(255, Math.max(0, v));

export function parseHex(hex) {
  const h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) throw new Error('cor inválida: ' + hex);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

export function toHex({ r, g, b }) {
  const q = (v) => Math.round(clamp255(v)).toString(16).padStart(2, '0');
  return '#' + q(r) + q(g) + q(b);
}

/** k=0 devolve `a`, k=1 devolve `b`. */
export function mix(a, b, k = 0.5) {
  const A = parseHex(a), B = parseHex(b);
  return toHex({ r: A.r + (B.r - A.r) * k, g: A.g + (B.g - A.g) * k, b: A.b + (B.b - A.b) * k });
}

const INK_DARK = '#0B0C0E';
const PAPER = '#FDFFF8';
/** Escurece em direcção à tinta (não ao preto puro, que mata a saturação). */
export const shade = (c, k) => mix(c, INK_DARK, k);
/** Clareia em direcção ao papel. */
export const tint = (c, k) => mix(c, PAPER, k);

/** h em graus [0,360), s e l em [0,1]. */
export function hsl(hex) {
  const { r, g, b } = parseHex(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: Math.min(1, s), l };
}

/* ---------- as seis famílias que o dono pediu ---------- */

// O pedido (26 out 2026) foi literal: «vermelho, verde, azul, roxo, amarelo e azul céu».
// Aqui ficam os intervalos de matiz que cada nome admite, para o teste poder dizer — sem olhos —
// que as seis cores estão mesmo lá e que nenhuma sala ficou com a cor de outra.
export const GLASS_FAMILIES = [
  { name: 'amarelo', from: 38, to: 58 },
  { name: 'verde', from: 100, to: 165 },
  { name: 'azul céu', from: 186, to: 207 },
  { name: 'azul', from: 208, to: 252 },
  { name: 'roxo', from: 258, to: 300 },
  { name: 'vermelho', from: 345, to: 360 }, // e 0–12: o vermelho atravessa o zero
  { name: 'vermelho', from: 0, to: 12 },
];

/** O nome da família de uma cor, ou 'neutro' para vidro fosco, ou null se não pertencer a nenhuma. */
export function familyOf(hex) {
  const { h, s, l } = hsl(hex);
  if (s < 0.22 || l > 0.93 || l < 0.10) return 'neutro'; // vidro fosco: o centro, de propósito
  for (const f of GLASS_FAMILIES) if (h >= f.from && h <= f.to) return f.name;
  return null;
}

/* ---------- as camadas do chão de vidro ---------- */

/**
 * De uma cor de vidro saem as quatro peças do chão, derivadas — nunca escritas à mão:
 *   base  · o tom fundo, opaco: é o que dá profundidade ao vidro e o que garante a cor num
 *           ecrã que não faça transparência;
 *   glass · a laje translúcida, com verniz;
 *   edge  · a aresta polida, mais clara (é assim que o vidro real apanha a luz na espessura);
 *   pool  · a poça de luz do candeeiro, uma mancha branca suave por cima.
 * `wash` não entra na cena: é o tom pálido da mesma família, para pistas e filetes no HTML.
 */
export function glassLayers(color) {
  parseHex(color); // falha cedo e com o nome da cor, não lá dentro do WebGL
  return {
    color,
    base: shade(color, 0.46),
    glass: color,
    edge: tint(color, 0.34),
    pool: '#FFFFFF',
    wash: mix(color, PAPER, 0.88),
  };
}
