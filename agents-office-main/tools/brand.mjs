// A MARCA em ficheiros — ícone e imagem de partilha (29 out 2026, lançamento).
//
//   node tools/brand.mjs
//
// Porque é que isto é um script e não três ficheiros desenhados à mão: o ícone tem de acompanhar a
// paleta das seis salas (`src/data.js`), e a imagem de partilha tem de mostrar o PRODUTO — o
// escritório a sério, com as seis salas, as pontes e o Cérebro — não um cartão genérico. Se um dia
// a paleta mudar, corre-se isto outra vez e os três ficheiros acompanham.
//
// Escreve em `assets/brand/`:
//   · `icon.svg`       — o favicon (vetorial, nítido a qualquer tamanho)
//   · `icon-180.png`   — o apple-touch-icon (iOS não aceita SVG)
//   · `icon-512.png`   — o ícone grande (manifesto / atalhos)
//   · `og.png` 1200×630 — a imagem de partilha (Open Graph, Twitter/X, WhatsApp, Slack)
// O `build.mjs` copia-os para `dist/`. Sem dependências: o PNG é escrito à mão com `node:zlib`.
import './domstub.mjs';
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { renderPNG, writePNG } from './raster.mjs';
import { makePlinth, makeWalkway, DOOR, WALL, makeRoomWalls, makeRoomEntrance } from '../src/builders.js';
import { DEPTS, DEPT_KEYS, LAYOUT } from '../src/data.js';
import { doorPlan } from '../src/circulation.js';

const OUT = path.resolve('assets/brand');
fs.mkdirSync(OUT, { recursive: true });

const CREAM = [253, 255, 248];
const INK = [21, 20, 20];
const SAGE = [174, 182, 171];

/* ---------- um mini-canvas, com antialiasing por super-amostragem ---------- */
function canvas(w, h, bg = CREAM) {
  const data = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { data[i * 3] = bg[0]; data[i * 3 + 1] = bg[1]; data[i * 3 + 2] = bg[2]; }
  return { w, h, data };
}
/** pinta um pixel com mistura (alpha) */
function px(c, x, y, rgb, a = 1) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || a <= 0) return;
  const i = (y * c.w + x) * 3;
  const k = Math.min(1, a);
  c.data[i] = Math.round(c.data[i] * (1 - k) + rgb[0] * k);
  c.data[i + 1] = Math.round(c.data[i + 1] * (1 - k) + rgb[1] * k);
  c.data[i + 2] = Math.round(c.data[i + 2] * (1 - k) + rgb[2] * k);
}
/** um disco (com bordo suave de 1 px) */
function disc(c, cx, cy, r, rgb, a = 1) {
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, r - d + 0.5));   // 1 dentro, 0 fora, rampa de 1 px
      px(c, x, y, rgb, a * cover);
    }
  }
}
/** um anel */
function ring(c, cx, cy, r, thick, rgb, a = 1) {
  const x0 = Math.floor(cx - r - thick - 1), x1 = Math.ceil(cx + r + thick + 1);
  const y0 = Math.floor(cy - r - thick - 1), y1 = Math.ceil(cy + r + thick + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, (r + thick / 2) - d + 0.5)) * Math.max(0, Math.min(1, d - (r - thick / 2) + 0.5));
      px(c, x, y, rgb, a * cover);
    }
  }
}
/** retângulo de cantos redondos */
function roundRect(c, x0, y0, w, h, r, rgb, a = 1) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      const dx = Math.min(Math.max(x + 0.5 - (x0 + r), 0), Math.max(w - 2 * r, 0)) + (x + 0.5 < x0 + r ? (x0 + r) - (x + 0.5) : 0);
      const cx = x + 0.5 < x0 + r ? x0 + r : (x + 0.5 > x0 + w - r ? x0 + w - r : x + 0.5);
      const cy = y + 0.5 < y0 + r ? y0 + r : (y + 0.5 > y0 + h - r ? y0 + h - r : y + 0.5);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, r - d + 0.5));
      px(c, x, y, rgb, a * cover);
      void dx;
    }
  }
}
/** PNG (RGB, 8 bits, sem alfa) — o suficiente para favicons opacos */
function png(c) {
  const raw = Buffer.alloc((c.w * 3 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 3 + 1)] = 0;
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 3, o = y * (c.w * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, Math.round(c.data[i + k])));
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return crc ^ -1;
}


/* ---------- letras: uma fonte de 5×7 desenhada à mão (só o que a marca precisa) ----------
   O rasterizador deste repositório não sabe desenhar texto (não há motor de fontes), e uma imagem
   de partilha sem o nome do produto não é uma imagem de partilha. Em vez de arrastar uma dependência
   de tipografia para dentro de um script de build, as vinte e poucas letras que a marca usa estão
   aqui, em pontos: 1 = tinta, 0 = fundo. É o que um designer faria num ecrã de 8 bits. */
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
};
/** Escreve `text` com `scale` px por ponto, com `track` px entre letras. Devolve a largura usada. */
function text(c, text, x0, y0, scale, rgb, track = 1, alpha = 1) {
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) px(c, x + col * scale + dx, y0 + r * scale + dy, rgb, alpha);
        }
      }
    }
    x += 5 * scale + track;
  }
  return x - x0 - track;
}
/** O acento agudo, à mão: uma barra fina por cima da letra que o leva. */
function acute(c, x, y, scale, rgb) {
  for (let i = 0; i < 2 * scale; i++) px(c, x + i, y - i - 1, rgb, 1);
}

/* ---------- 1 · o favicon vetorial (a mesma ideia, em SVG) ---------- */
const cores = DEPT_KEYS.map((k) => DEPTS[k].glass);
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Órbita Agentes">
  <rect width="64" height="64" rx="15" fill="#FDFFF8"/>
  <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.4" fill="none" stroke="#151414" stroke-opacity=".14"/>
  <circle cx="32" cy="32" r="21.5" fill="none" stroke="#151414" stroke-opacity=".55" stroke-width="1.4"/>
  <circle cx="32" cy="32" r="6.6" fill="#4C7A57"/>
  <circle cx="32" cy="32" r="2.4" fill="#FDFFF8" fill-opacity=".9"/>
${cores.map((c, i) => {
  const a = (i / cores.length) * Math.PI * 2 - Math.PI / 2;
  const x = (32 + Math.cos(a) * 21.5).toFixed(2), y = (32 + Math.sin(a) * 21.5).toFixed(2);
  return `  <circle cx="${x}" cy="${y}" r="3.5" fill="${c}"/>`;
}).join('\n')}
</svg>
`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), iconSvg);
console.log('assets/brand/icon.svg');

/* ---------- 2 · os PNG do ícone (o mesmo desenho, rasterizado) ---------- */
function iconPng(size) {
  const S = 3;                       // super-amostragem para as arestas
  const c = canvas(size * S, size * S, CREAM);
  const k = size * S;
  const R = k * 0.336;               // o anel das salas
  roundRect(c, 0, 0, k, k, k * 0.23, CREAM, 1);                 // o fundo (já é creme)
  ring(c, k / 2, k / 2, R, k * 0.024, INK, 0.55);
  cores.forEach((hex, i) => {
    const a = (i / cores.length) * Math.PI * 2 - Math.PI / 2;
    const rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    disc(c, k / 2 + Math.cos(a) * R, k / 2 + Math.sin(a) * R, k * 0.055, rgb, 1);
  });
  disc(c, k / 2, k / 2, k * 0.103, [0x4c, 0x7a, 0x57], 1);      // o Cérebro
  disc(c, k / 2, k / 2, k * 0.037, CREAM, 0.9);
  // reduzir por média de blocos (a super-amostragem a fazer o antialiasing)
  const out = canvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * (size * S) + (x * S + sx)) * 3;
          acc[0] += c.data[i]; acc[1] += c.data[i + 1]; acc[2] += c.data[i + 2];
        }
      }
      const n = S * S, o = (y * size + x) * 3;
      out.data[o] = acc[0] / n; out.data[o + 1] = acc[1] / n; out.data[o + 2] = acc[2] / n;
    }
  }
  return out;
}
for (const size of [180, 512]) {
  const c = iconPng(size);
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png(c));
  console.log(`assets/brand/icon-${size}.png`);
}

/* ---------- 3 · a imagem de partilha: o escritório, não um cartão ---------- */
const root = new THREE.Group();
const plates = {};
for (const k of DEPT_KEYS) plates[k] = doorPlan(k, LAYOUT, { x: 8, z: 8 });
for (const k of ['brain', ...DEPT_KEYS]) {
  const L = LAYOUT[k], dept = DEPTS[k];
  const g = new THREE.Group();
  g.position.set(L.pos[0], 0, L.pos[1]);
  root.add(g);
  g.add(makePlinth(L.w, L.d, dept.glass));
  if (k === 'brain') continue;
  const pl = plates[k];
  const opening = pl.walled
    ? {
      side: pl.openingSide,
      at: pl.openingSide === '-z' ? pl.local.x : pl.local.z,
      w: DOOR.clearW + DOOR.frameW * 2 + 0.04,
      h: DOOR.clearH + DOOR.frameW + 0.04,
    }
    : null;
  g.add(makeRoomWalls(L.w, L.d, dept.chip, dept.ink, dept.short, { glass: dept.glass, opening }));
  const at = pl.walled
    ? (pl.side === '-z'
      ? { x: pl.local.x, z: -L.d / 2 + WALL.t + DOOR.frameD / 2 }
      : { x: -L.w / 2 + WALL.t + DOOR.frameD / 2, z: pl.local.z })
    : (pl.side === '+z'
      ? { x: pl.local.x, z: L.d / 2 - 0.03 }
      : { x: L.w / 2 - 0.03, z: pl.local.z });
  const span = (pl.side === '+x' || pl.side === '-x') ? L.d : L.w;
  g.add(makeRoomEntrance({
    glass: dept.glass, at, dir: pl.dir, label: dept.short,
    screen: pl.screen, screenLen: pl.screen ? Math.min(span - 0.6, 6.6) : 0,
  }));
  root.add(makeWalkway([pl.bridge.from.x, pl.bridge.from.z], [pl.bridge.to.x, pl.bridge.to.z],
    { glass: dept.glass, chip: dept.chip }));
}
root.updateMatrixWorld(true);

const W = 1200, H = 630;
const FR = 60, aspect = W / H;
const cam = new THREE.OrthographicCamera(-FR * aspect, FR * aspect, FR, -FR, -400, 900);
/* vista mais de cima do que a da app: numa imagem de partilha o que tem de se ler em 1 segundo é a
   PLANTA — seis salas em volta do Cérebro, seis pontes. A diagonal é a da app, a elevação não. */
const ISO = new THREE.Vector3(1, 1.06, 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
cam.position.copy(new THREE.Vector3(0, 0, 0)).addScaledVector(ISO, 260);
cam.up.set(0, 1, 0);
cam.lookAt(0, 0, 0);
cam.zoom = 1.06;
cam.updateProjectionMatrix();
const r = renderPNG({ width: W, height: H, camera: cam, objects: [root], bg: [253, 255, 248] });
// uma vinheta muito leve, para a imagem não acabar a branco no feed
{
  const { img } = r;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
      const k = Math.min(1, Math.pow(Math.hypot(dx, dy) / 1.55, 2.4)) * 0.10;
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) img[i + c] = img[i + c] * (1 - k) + [236, 238, 230][c] * k;
    }
  }
}
/* a marca escrita: sem isto, a imagem é uma planta bonita sem nome. O texto entra DEPOIS do
   desenho e por cima dele, no canto que a câmara deixa vazio (canto superior esquerdo). */
{
  /* `writePNG` lê `img.buffer` como bytes — a tela aqui tem de ser Uint8Array, não Float32Array
     (a primeira versão disto saiu a preto com riscas: era o buffer de floats lido como bytes). */
  const c = { w: W, h: H, data: new Uint8Array(W * H * 3) };
  for (let i = 0; i < W * H * 3; i++) c.data[i] = r.img[i];
  const tinta = [21, 20, 20];
  const cinza = [90, 90, 90];
  // «ÓRBITA» e «AGENTES» em duas linhas? Não: a marca é uma linha, com AGENTES em cinza.
  const s1 = 5;
  const w1 = text(c, 'ORBITA', 74, 62, s1, tinta, 3);
  acute(c, 74 + 0 * (5 * s1 + 3) + 3 * s1, 62, s1, tinta);          // o acento de ÓRBITA
  text(c, 'AGENTES', 74 + w1 + 26, 62, s1, cinza, 3);
  // o acento de CÉREBRO cai na última palavra: mede-se onde ela começa para o pôr no sítio
  const antes = text(c, 'SEIS SALAS · 35 AGENTES · UM ', 76, 108, 2, cinza, 2);
  text(c, 'CEREBRO', 76 + antes + 2, 108, 2, cinza, 2);
  acute(c, 76 + antes + 2 + 3 * 2, 108, 2, cinza);
  // o traço da marca, por baixo do título
  for (let x = 76; x < 76 + 168; x++) for (let y = 0; y < 2; y++) px(c, x, 158 + y, tinta, 0.16);
  writePNG(path.join(OUT, 'og.png'), { img: c.data, width: W, height: H });
}
console.log(`assets/brand/og.png (${W}×${H}, ${r.tris} triângulos)`);
