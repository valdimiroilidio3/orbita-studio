// Inspecção da SALA-MESTRE (o Cérebro como sala) — sem browser, sem WebGL.
//
//   node tools/master.mjs [camx,camy,camz] [atx,aty,atz] [fov] [out.png]
//
// Limitações (ditas): o rasterizador caseiro não tem emissão, texturas, bloom nem tone mapping.
// O LED aparece como geometria (a calha, o aro, a linha do corredor), não como luz — serve para
// julgar VOLUMES, PROPORÇÕES e COMPOSIÇÃO: os seis púlpitos, o anel, as colunas e os chefes nos
// seus lugares. A cor de cada púlpito é a da sala que representa.
import './domstub.mjs';
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePlinth, makeMasterHall, makeWalkway } from '../src/builders.js';
import { makePerson, posePerson } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS, DEPTS, DEPT_KEYS, LAYOUT } from '../src/data.js';

const [cam = '19,15,21', at = '0,1.8,0', fov = '34', out = '/tmp/master.png'] = process.argv.slice(2);
const g = new THREE.Group();
g.add(makePlinth(16, 16, DEPTS.brain.glass));

const hall = makeMasterHall({
  glass: DEPTS.brain.glass,
  ink: DEPTS.brain.ink,
  spots: DEPT_KEYS.map((k) => ({
    dept: k, color: DEPTS[k].glass,
    angle: Math.atan2(LAYOUT[k].pos[1], LAYOUT[k].pos[0]),
  })),
});
g.add(hall);

// dois corredores, para se ver como chegam à sala
for (const k of ['marketing', 'delivery']) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const from = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
  const to = [sx * 6.5, sz * 6.5];
  const w = makeWalkway(from, to, { glass: DEPTS[k].glass, chip: DEPTS[k].chip });
  w.traverse((o) => { if (o.isMesh) o.visible = true; });
  g.add(w);
}

// os seis chefes, cada um no seu lugar, virado ao orbe
for (const s of hall.userData.hall.spots) {
  const a = AGENTS.find((x) => x.dept === s.dept && x.lead);
  if (!a) continue;
  const p = makePerson({ look: lookFor(a) });
  p.position.set(s.standX, 0.06, s.standZ);
  p.rotation.y = s.faceY;
  posePerson(p, 'stand', 1000);
  g.add(p);
}
g.updateMatrixWorld(true);

const [cx, cy, cz] = cam.split(',').map(Number);
const [tx, ty, tz] = at.split(',').map(Number);
const c = new THREE.PerspectiveCamera(Number(fov), 1100 / 760, 0.1, 200);
c.position.set(cx, cy, cz);
c.lookAt(tx, ty, tz);
const r = renderPNG({ width: 1100, height: 760, camera: c, objects: [g] });
writePNG(out, r);
console.log(`${out} · ${r.tris} triângulos · ${hall.userData.hall.spots.length} lugares`);
