// Um posto inteiro (secretária + cadeira + pessoa) visto de onde se quiser. É este o teste que
// interessa para o pedido 28: ver se as mãos aterram no teclado e no rato, não só se o teste passa.
import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makeDesk, makeChair } from '../src/builders.js';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';
import { contact } from '../src/deskmap.js';

const [id, mode, cam, at, fov, out, W = 900, H = 680] = process.argv.slice(2);
const root = new THREE.Group();
root.position.y = 0.12;
const station = new THREE.Group();
root.add(station);
const { group: desk, caps, mouse } = makeDesk('#CFEBDD', null, { glass: '#1FA36B', seed: 0 });
station.add(desk);
const chair = makeChair({ glass: '#1FA36B', chip: '#CFEBDD' });
chair.position.set(0, 0, 1.75);
station.add(chair);
const p = makePerson({ look: lookFor(AGENTS.find((a) => a.id === id)) });
p.rotation.y = Math.PI;
station.add(p);
// aquece o IK como no simulador (um passo por frame), para a pose ser a de regime
let con = null;
for (let t = 0; t <= 3000; t += 16) { con = contact(t, 0.2, mode); poseWork(p, mode, t, 0.016, con); }
if (con.keys) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  caps.getMatrixAt(con.keys.cell, m); m.decompose(v, q, sc); v.y -= 0.010; m.compose(v, q, sc);
  caps.setMatrixAt(con.keys.cell, m); caps.instanceMatrix.needsUpdate = true;
}
if (con.mouse) mouse.position.set(con.mouse.x, mouse.position.y, con.mouse.z);
root.updateMatrixWorld(true);
const c = new THREE.PerspectiveCamera(Number(fov), Number(W) / Number(H), 0.05, 100);
c.position.set(...cam.split(',').map(Number));
c.lookAt(...at.split(',').map(Number));
const r = renderPNG({ width: Number(W), height: Number(H), camera: c, objects: [root] });
writePNG(out, r);
console.log(out, r.tris);
