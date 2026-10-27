import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makeDesk } from '../src/builders.js';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';
import { contact } from '../src/deskmap.js';

const [id, mode, pos, at, out] = process.argv.slice(2);
const root = new THREE.Group();
root.position.y = 0.12;
const { group: desk, caps, mouse } = makeDesk('#CFEBDD', null, { glass: '#1FA36B', seed: 0 });
root.add(desk);
const p = makePerson({ look: lookFor(AGENTS.find((a) => a.id === id)) });
p.position.set(0, 0.55, 1.7); p.rotation.y = Math.PI;
const con = contact(1200, 0.2, mode);
poseWork(p, mode, 1200, 30, con);
root.add(p);
if (con.keys) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  caps.getMatrixAt(con.keys.cell, m); m.decompose(v, q, sc); v.y -= 0.008; m.compose(v, q, sc);
  caps.setMatrixAt(con.keys.cell, m); caps.instanceMatrix.needsUpdate = true;
}
if (con.mouse) mouse.position.set(con.mouse.x, mouse.position.y, con.mouse.z);
root.updateMatrixWorld(true);
const c = new THREE.PerspectiveCamera(28, 760 / 560, 0.05, 100);
c.position.set(...pos.split(',').map(Number));
c.lookAt(...at.split(',').map(Number));
const r = renderPNG({ width: 760, height: 560, camera: c, objects: [root] });
writePNG(out, r);
console.log(out, r.tris);
