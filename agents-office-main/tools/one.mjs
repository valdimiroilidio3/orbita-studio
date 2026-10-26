import * as THREE from 'three';
import { renderPNG, writePNG } from './raster.mjs';
import { makePerson, poseWork } from '../src/avatar.js';
import { lookFor } from '../src/looks.js';
import { AGENTS } from '../src/data.js';
import { contact } from '../src/deskmap.js';

const [id, mode, cams, out] = process.argv.slice(2);
const p = makePerson({ look: lookFor(AGENTS.find((a) => a.id === id)) });
if (mode === 'read') poseWork(p, 'read', 1000, 30);
else poseWork(p, mode, 1200, 30, contact(1200, 0.2, mode));
p.updateMatrixWorld(true);
const [px, py, pz, tx, ty, tz, fov] = cams.split(',').map(Number);
const c = new THREE.PerspectiveCamera(fov, 620 / 820, 0.05, 100);
c.position.set(px, py, pz); c.lookAt(tx, ty, tz);
const r = renderPNG({ width: 620, height: 820, camera: c, objects: [p] });
writePNG(out, r);
console.log(out, r.tris);
