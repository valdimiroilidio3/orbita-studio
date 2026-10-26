// Inspecção da PORTA de uma sala, sem browser e sem WebGL.
//
//   node tools/porta.mjs <out.png> [ang] [elev] [zoom] [cor] [nome]
//
// Monta o grupo da entrada tal como o `main.js` o monta e desenha-o com o rasterizador caseiro.
// Limitações (ditas): sem emissão, sem texturas, sem transparência a sério — a placa aparece sem
// texto e o LED sem brilho. Serve para julgar VOLUMES e proporções: foi assim que se viu que os
// montantes da primeira porta começavam a 1,3 m do chão.
import './domstub.mjs';
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makeRoomEntrance } from '../src/builders.js';

const [out = '/tmp/porta.png', ang = '24', elev = '0.42', zoom = '21', glass = '#8B5AD6', label = 'VENDAS'] = process.argv.slice(2);
const root = new THREE.Group();
const ent = makeRoomEntrance({ glass, at: { x: 0, z: 0 }, dir: { x: 0, z: 1 }, label });
root.add(ent);
root.updateMatrixWorld(true);

const FR = 42, W = 1000, H = 700, aspect = W / H;
const c = new THREE.OrthographicCamera(-FR * aspect, FR * aspect, FR, -FR, -400, 800);
const ISO = new THREE.Vector3(1, Number(elev), 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Number(ang) * Math.PI) / 180);
c.position.set(0, 1.35, 0).addScaledVector(ISO, 200);
c.up.set(0, 1, 0); c.lookAt(0, 1.35, 0);
c.zoom = Number(zoom); c.updateProjectionMatrix();
const r = renderPNG({ width: W, height: H, camera: c, objects: [root] });
writePNG(out, r);
console.log(out, r.tris, 'triângulos', JSON.stringify(ent.userData.entrance));
