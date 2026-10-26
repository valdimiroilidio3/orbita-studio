import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';
import { contact } from '../src/deskmap.js';

// 1) folha de contacto: os 35, vistos de trás (é o ângulo da câmara na cena)
const COLS = 7, ROWS = 5, CW = 200, CH = 300;
const W = COLS * CW, H = ROWS * CH;
const big = new THREE.Group();
AGENTS.forEach((a, i) => {
  const p = makePerson({ look: lookFor(a) });
  poseWork(p, 'type', 1200, 20, contact(1200, i * 0.13, 'type'));
  const col = i % COLS, row = Math.floor(i / COLS);
  p.position.set((col - (COLS - 1) / 2) * 1.6, 0, -row * 1.9);
  p.rotation.y = Math.PI;   // de costas, como na cena
  big.add(p);
});
// câmara única para a folha inteira: vista de trás e de cima
const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);
cam.position.set(0, 9.5, -13);
cam.lookAt(0, 2.2, -4.0);
const out = renderPNG({ width: W, height: H, camera: cam, objects: [big] });
writePNG('/tmp/av-35-costas.png', out);
console.log('folha de costas', out.tris, 'triângulos');

// 2) close-ups: frente, costas e mãos no teclado
const shots = [];
const mk = (id, mode, camPos, look, t = 1200) => {
  const a = AGENTS.find((x) => x.id === id);
  const p = makePerson({ look: lookFor(a) });
  const con = contact(t, 0.2, mode);
  poseWork(p, mode, t, 20, con);
  p.updateMatrixWorld(true);
  const c = new THREE.PerspectiveCamera(34, 340 / 420, 0.1, 100);
  c.position.set(...camPos);
  c.lookAt(...look);
  const r = renderPNG({ width: 340, height: 420, camera: c, objects: [p] });
  return { id, mode, r, p, con };
};
const S = [
  mk('elead', 'type', [1.9, 3.4, -2.6], [0, 2.3, 0.4]),      // costas/ombro
  mk('report', 'type', [1.6, 3.2, 2.9], [0, 2.4, 0.3]),      // frente
  mk('imail', 'mouse', [2.2, 3.6, 3.0], [0.4, 2.2, 1.4]),    // mão no rato
  mk('ona', 'type', [-2.3, 3.3, 2.6], [0, 2.4, 0.6]),        // mulher, tranças
];
const SW = 340 * S.length, SH = 420;
const sheet = new Uint8Array(SW * SH * 3);
const chans = S.map((s) => s.r);
for (let k = 0; k < S.length; k++) {
  const src = chans[k];
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < 340; x++) {
      const di = (y * SW + x + k * 340) * 3, si = (y * src.width + x) * 3;
      sheet[di] = src.img[si]; sheet[di + 1] = src.img[si + 1]; sheet[di + 2] = src.img[si + 2];
    }
  }
}
writePNG('/tmp/av-closeups.png', { img: sheet, width: SW, height: SH });
console.log('close-ups prontos');
