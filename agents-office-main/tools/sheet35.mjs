// Folha dos 35, de frente: cabelo, chapéu, óculos, barba, gravata/lenço e casaco na cor da sala.
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePerson } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';

const TW = 190, TH = 250, COLS = 7, ROWS = 5;
const W = TW * COLS, H = TH * ROWS;
const out = new Uint8Array(W * H * 3).fill(240);
for (let i = 0; i < W * H; i++) { out[i * 3] = 246; out[i * 3 + 1] = 247; out[i * 3 + 2] = 244; }
AGENTS.forEach((a, i) => {
  const p = makePerson({ look: lookFor(a) });
  const c = new THREE.PerspectiveCamera(24, TW / TH, 0.1, 60);
  c.position.set(0, 3.05, 6.4);
  c.lookAt(0, 2.75, 0);
  const r = renderPNG({ width: TW, height: TH, camera: c, objects: [p] });
  const cx = (i % COLS) * TW, cy = Math.floor(i / COLS) * TH;
  for (let y = 0; y < TH; y++) {
    out.set(r.img.subarray(y * TW * 3, (y + 1) * TW * 3), ((cy + y) * W + cx) * 3);
  }
});
writePNG('docs/avatares-35.png', { img: out, width: W, height: H });
console.log('docs/avatares-35.png', W, H);
