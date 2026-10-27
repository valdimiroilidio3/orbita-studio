// Inspecção da PLANTA das portas: as seis salas, as seis portas, as seis passadeiras.
//
//   node tools/portas.mjs <out.png> [zoom] [ang] [elev]
//
// Monta a planta tal como o `main.js` a monta — pod + paredes com o vão + porta (com o anteparo,
// quando a porta cai no lado aberto) + passadeira — e desenha-a com o rasterizador caseiro, sem
// browser e sem WebGL. É este desenho que responde à pergunta do pedido 36: *a porta abre para o
// Cérebro e a ponte sai dela?*
//
// Limitações (ditas): sem materiais, sem texturas, sem LED, sem transparência — a placa aparece sem
// texto e o vidro como massa. Serve para julgar SÍTIO, eixo e ligação, que é o que aqui se discute.
import './domstub.mjs';
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePlinth, makeRoomWalls, makeRoomEntrance, makeWalkway, DOOR, WALL } from '../src/builders.js';
import { DEPTS, DEPT_KEYS, LAYOUT } from '../src/data.js';
import { doorPlan } from '../src/circulation.js';

const [out = '/tmp/portas.png', zoom = '0.86', ang = '45', elev = '1.6'] = process.argv.slice(2);

const root = new THREE.Group();
const plates = {};
for (const k of DEPT_KEYS) plates[k] = doorPlan(k, LAYOUT, { x: 8, z: 8 });

/* o Cérebro primeiro: é ele que dá sentido a tudo o resto (é o centro desta planta) */
for (const k of ['brain', ...DEPT_KEYS]) {
  const L = LAYOUT[k];
  const dept = DEPTS[k];
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

  root.add(makeWalkway(
    [pl.bridge.from.x, pl.bridge.from.z],
    [pl.bridge.to.x, pl.bridge.to.z],
    { glass: dept.glass, chip: dept.chip },
  ));
}

root.updateMatrixWorld(true);

const FR = 42, W = 1200, H = 1000, aspect = W / H;
const c = new THREE.OrthographicCamera(-FR * aspect, FR * aspect, FR, -FR, -400, 900);
const ISO = new THREE.Vector3(1, Number(elev), 1).normalize()
  .applyAxisAngle(new THREE.Vector3(0, 1, 0), (Number(ang) * Math.PI) / 180);
const target = new THREE.Vector3(0, 0, 0);
c.position.copy(target).addScaledVector(ISO, 260);
c.up.set(0, 1, 0);
c.lookAt(target);
c.zoom = Number(zoom);
c.updateProjectionMatrix();

const r = renderPNG({ width: W, height: H, camera: c, objects: [root] });
writePNG(out, r);
console.log(out, r.tris, 'triângulos');
for (const k of DEPT_KEYS) {
  const p = plates[k];
  console.log(
    k.padEnd(10),
    'lado ' + p.side.padEnd(3),
    p.walled ? 'parede ' + p.openingSide : 'ANTEPARO',
    '| porta ' + p.at.x.toFixed(1) + ',' + p.at.z.toFixed(1),
    '| ponte ' + p.bridge.len.toFixed(1) + ' m → ' + p.bridge.to.x + ',' + p.bridge.to.z,
  );
}
