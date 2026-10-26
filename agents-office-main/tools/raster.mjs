// Rasterizador mínimo (só para inspecção durante o desenvolvimento).
// Lê a geometria real dos avatares (mesma que a cena usa) e desenha com z-buffer + sombreado plano.
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';

const LIGHT = new THREE.Vector3(0.45, 0.82, 0.35).normalize();

export function renderPNG({ width, height, camera, objects, bg = [246, 247, 244] }) {
  const buf = new Float32Array(width * height).fill(Infinity);
  const img = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) { img[i * 3] = bg[0]; img[i * 3 + 1] = bg[1]; img[i * 3 + 2] = bg[2]; }
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  let tris = 0;

  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (let p2 = o; p2; p2 = p2.parent) if (p2.visible === false) return;   // respeitar visible
      const g = o.geometry;
      const pos = g.attributes.position;
      const col = g.attributes.color;
      const idx = g.index;
      const mat = o.material;
      const base = mat && mat.color ? mat.color : new THREE.Color(1, 1, 1);
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t < count; t += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(t + k) : t + k;
          p[k].fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
          if (col) { c[k].fromBufferAttribute(col, vi); c[k].multiply(base); } else { c[k].copy(base); }
        }
        // normal plana em mundo
        n.copy(p[1]).sub(p[0]).cross(new THREE.Vector3().copy(p[2]).sub(p[0])).normalize();
        const shade = 0.34 + 0.66 * Math.abs(n.dot(LIGHT));
        const proj = p.map((pt) => {
          v.copy(pt).project(camera);
          return { x: (v.x * 0.5 + 0.5) * width, y: (1 - (v.y * 0.5 + 0.5)) * height, z: v.z };
        });
        const area = (proj[1].x - proj[0].x) * (proj[2].y - proj[0].y) - (proj[2].x - proj[0].x) * (proj[1].y - proj[0].y);
        if (Math.abs(area) < 1e-9) continue;
        const minX = Math.max(0, Math.floor(Math.min(proj[0].x, proj[1].x, proj[2].x)));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(proj[0].x, proj[1].x, proj[2].x)));
        const minY = Math.max(0, Math.floor(Math.min(proj[0].y, proj[1].y, proj[2].y)));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(proj[0].y, proj[1].y, proj[2].y)));
        if (maxX < minX || maxY < minY) continue;
        const r = ((c[0].r + c[1].r + c[2].r) / 3) * shade;
        const gg = ((c[0].g + c[1].g + c[2].g) / 3) * shade;
        const b = ((c[0].b + c[1].b + c[2].b) / 3) * shade;
        const R = Math.max(0, Math.min(255, Math.round(Math.pow(r, 1 / 2.2) * 255)));
        const G = Math.max(0, Math.min(255, Math.round(Math.pow(gg, 1 / 2.2) * 255)));
        const B = Math.max(0, Math.min(255, Math.round(Math.pow(b, 1 / 2.2) * 255)));
        tris++;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const w0 = ((proj[1].x - x) * (proj[2].y - y) - (proj[2].x - x) * (proj[1].y - y)) / area;
            const w1 = ((proj[2].x - x) * (proj[0].y - y) - (proj[0].x - x) * (proj[2].y - y)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * proj[0].z + w1 * proj[1].z + w2 * proj[2].z;
            const o2 = y * width + x;
            if (z >= buf[o2]) continue;   // NDC: mais perto = z menor
            buf[o2] = z;
            img[o2 * 3] = R; img[o2 * 3 + 1] = G; img[o2 * 3 + 2] = B;
          }
        }
      }
    });
  }
  return { img, width, height, tris };
}

/* ---------- PNG (RGB, sem filtros) ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
export function writePNG(path, { img, width, height }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(img.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}
