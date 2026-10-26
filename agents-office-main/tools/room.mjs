// Inspecção de uma SALA: monta o pod (chão + paredes + secretárias + pessoas + plantas) tal como o
// main.js o monta e desenha-o com o rasterizador caseiro — sem browser, sem WebGL.
//
//   node tools/room.mjs <dept> <cam> <at> <fov> <out.png> [w] [h]
//
// Limitações (ditas): sem materiais, sem texturas, sem LED, sem bloom, sem tone mapping. Serve para
// julgar VOLUMES, proporções e composição — que é o que «chique» quer dizer nesta fase.
import './domstub.mjs';
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import {
  makePlinth, makeRoomWalls, makeDesk, makeChair, makePlant, makeWalkway, makeRoomDressing,
} from '../src/builders.js';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { contact } from '../src/deskmap.js';
import { AGENTS, DEPTS, LAYOUT, stationSpot, deskFront } from '../src/data.js';

const [deptKey = 'marketing', cam = '26,22,34', at = '0,0,0', fov = '30', out = '/tmp/room.png', W = 1100, H = 800] = process.argv.slice(2);
const L = LAYOUT[deptKey];
const dept = DEPTS[deptKey];

const root = new THREE.Group();
const pod = new THREE.Group();
root.add(pod);

const plinth = makePlinth(L.w, L.d, dept.glass);
pod.add(plinth);
if (deptKey !== 'brain') {
  pod.add(makeRoomWalls(L.w, L.d, dept.chip, dept.ink, dept.short, { glass: dept.glass }));
  pod.add(makeRoomDressing(L.w, L.d, dept.glass, dept.chip, dept.ink, { front: deskFront(deptKey) }));
}

const agents = AGENTS.filter((a) => a.dept === deptKey);
const ANG = Math.PI / 4;
const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);
for (const a of agents) {
  const spot = stationSpot(a.dept, a.grid);          // a mesma conta que a cena usa (data.js)
  const base = new THREE.Vector3(spot.x, 0.12, spot.z);
  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const { group: desk } = makeDesk(dept.chip, null, { glass: dept.glass, seed: AGENTS.indexOf(a) });
  station.add(desk);
  const chair = makeChair({ glass: dept.glass, chip: dept.chip });
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  const p = makePerson({ look: lookFor(a) });
  p.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
  p.rotation.y = ANG + Math.PI;
  const t = 2000 + agents.indexOf(a) * 700;
  poseWork(p, agents.indexOf(a) % 2 ? 'mouse' : 'type', t, 30, contact(t, 0.2, agents.indexOf(a) % 2 ? 'mouse' : 'type'));
  pod.add(station);
  pod.add(p);
}
const kind = deptKey === 'delivery' || deptKey === 'marketing' || deptKey === 'ops' ? 'broad' : 'upright';
const plant = makePlant({ seed: 5, kind });
const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || 1;
plant.position.set(sx * (L.w / 2 - 2.6), 0.12, sz * (L.d / 2 - 2.6));
pod.add(plant);

root.updateMatrixWorld(true);
// a MESMA câmara da app: ortográfica, direcção ISO (1, .92, 1), half-height 42 / zoom
const FR = 42, aspect = Number(W) / Number(H);
const c = new THREE.OrthographicCamera(-FR * aspect, FR * aspect, FR, -FR, -400, 800);
const ang = (Number(fov) || 0) * Math.PI / 180;   // fov passa a ser o ÂNGULO de azimute
const ISO = new THREE.Vector3(1, 0.92, 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
const target = new THREE.Vector3(...at.split(',').map(Number));
c.position.copy(target).addScaledVector(ISO, 220);
c.up.set(0, 1, 0);
c.lookAt(target);
c.zoom = Number(cam);
c.updateProjectionMatrix();
const r = renderPNG({ width: Number(W), height: Number(H), camera: c, objects: [root] });
writePNG(out, r);
console.log(out, r.tris, 'triângulos');
