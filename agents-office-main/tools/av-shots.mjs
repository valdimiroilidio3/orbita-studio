import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';
import { contact } from '../src/deskmap.js';

function shot(p, { w = 420, h = 560, pos, at, fov = 32 }) {
  p.updateMatrixWorld(true);
  const c = new THREE.PerspectiveCamera(fov, w / h, 0.05, 100);
  c.position.set(...pos); c.lookAt(...at);
  return renderPNG({ width: w, height: h, camera: c, objects: [p] });
}
function tile(list, cols, w, h, file) {
  const rows = Math.ceil(list.length / cols);
  const img = new Uint8Array(cols * w * rows * h * 3);
  img.fill(245);
  list.forEach((r, i) => {
    const cx = (i % cols) * w, cy = Math.floor(i / cols) * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const di = ((cy + y) * cols * w + cx + x) * 3, si = (y * w + x) * 3;
      img[di] = r.img[si]; img[di + 1] = r.img[si + 1]; img[di + 2] = r.img[si + 2];
    }
  });
  writePNG(file, { img, width: cols * w, height: rows * h });
}

const one = (id, mode, pos, at, t = 1200, fov = 32) => {
  const p = makePerson({ look: lookFor(AGENTS.find((a) => a.id === id)) });
  poseWork(p, mode, t, 20, contact(t, 0.2, mode));
  return shot(p, { pos, at, fov });
};

// 1) um avatar grande, de costas (o ângulo da cena) e de frente
writePNG('/tmp/a-costas.png', one('elead', 'type', [0.9, 3.6, -4.6], [0, 2.5, 0.9], 1200, 34));
writePNG('/tmp/a-frente.png', one('elead', 'type', [2.2, 3.7, 5.0], [0, 2.5, 0.6], 1200, 34));
// 2) cabeça e ombros de perto, de frente
writePNG('/tmp/a-cabeca.png', one('report', 'type', [1.1, 3.9, 3.6], [0, 3.35, 0.1], 1200, 26));
// 3) mãos no teclado, de cima e de lado
writePNG('/tmp/a-maos.png', one('imail', 'type', [2.2, 4.4, 3.4], [0.1, 2.6, 1.0], 1200, 30));
writePNG('/tmp/a-rato.png', one('imail', 'mouse', [-2.4, 4.1, 3.4], [-0.9, 2.6, 1.1], 1200, 30));
// 4) os 35, cada um no seu enquadramento, de costas
const list = AGENTS.map((a, i) => {
  const p = makePerson({ look: lookFor(a) });
  poseWork(p, 'type', 1200, 20, contact(1200, i * 0.13, 'type'));
  return shot(p, { w: 180, h: 250, pos: [0.6, 3.5, -3.6], at: [0, 2.6, 0.9], fov: 42 });
});
tile(list, 7, 180, 250, '/tmp/a-35.png');
console.log('pronto');
